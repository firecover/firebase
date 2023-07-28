import { onObjectFinalized } from "firebase-functions/v2/storage";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirp } from "mkdirp";
import { bucket, firestore } from "./init";
import * as Zip from "adm-zip";
import { readFile, readdir, rmdir } from "node:fs/promises";
import * as logger from "firebase-functions/logger";
import { timeAfter } from "./utils";

class CoverageZip {
  private readonly processingTmpDirectory;
  private readonly zipTmpDirectory;
  private readonly zipFileLocation: string;
  private readonly repoId: string;
  private readonly triggerRef: string;
  private readonly uploadRefId: string;

  private readonly firestoreRepoDoc;

  constructor(private readonly gcsFilePath: string) {
    const extractedValues = this.extractDetailsFromBucketPath(gcsFilePath);
    this.repoId = extractedValues.repoId;
    this.triggerRef = extractedValues.triggerRef;
    this.uploadRefId = extractedValues.uploadRefId;

    this.firestoreRepoDoc = firestore.collection("repository").doc(this.repoId);

    const osTmpDirectory = tmpdir();
    this.processingTmpDirectory = join(
      osTmpDirectory,
      "process-" + this.uploadRefId
    );
    this.zipTmpDirectory = join(osTmpDirectory, "zip-" + this.uploadRefId);
    this.zipFileLocation = join(this.zipTmpDirectory, "compressed.zip");
  }

  private extractDetailsFromBucketPath(gcsFilePath: string): {
    repoId: string;
    triggerRef: string;
    uploadRefId: string;
  } {
    const segments = gcsFilePath.split("/");
    const repoId = segments[1].replace("repo_", "");
    const triggerRef = segments[2];
    const uploadRefId = segments[3].replace(".zip", "");

    return {
      repoId,
      triggerRef,
      uploadRefId,
    };
  }

  public async download_1() {
    await mkdirp(this.zipTmpDirectory);
    await bucket
      .file(this.gcsFilePath)
      .download({ destination: this.zipFileLocation });
  }

  public async unzip_2(zipFileLocation = this.zipFileLocation) {
    await mkdirp(this.processingTmpDirectory);
    await new Promise((resolve, reject) => {
      const zip = new Zip(zipFileLocation);
      zip.extractAllToAsync(this.processingTmpDirectory, true, false, (err) => {
        if (err) return reject(err);
        resolve(null);
      });
    });
  }

  public async saveContentToFirestore_3() {
    const { aggregatedCoverageSummary, componentCoverageFiles } =
      await this.getZipContent();

    const coverageStorageCollection = this.firestoreRepoDoc
      .collection("coverages")
      .doc(this.triggerRef)
      .collection(this.uploadRefId);
    const saveFileToFirestoreTasks = componentCoverageFiles.map(
      async (coverage) => {
        const content: JSONSummary = JSON.parse(
          (await readFile(coverage.file)).toString()
        );

        await coverageStorageCollection.doc(coverage.componentName).set({
          createdAt: new Date(),
          coverage: content,
          deleteAt: timeAfter(28),
        });
      }
    );

    const coverageSummaryContentTask = readFile(
      aggregatedCoverageSummary.file
    ).then((content) => JSON.parse(content.toString()) as FullCoverage);

    const [coverageSummaryContent] = await Promise.all([
      coverageSummaryContentTask,
      saveFileToFirestoreTasks,
    ]);

    // save this last
    await coverageStorageCollection.doc("_aggregated-coverage-summary").set({
      createdAt: new Date(),
      coverage: coverageSummaryContent,
      deleteAt: timeAfter(28),
    });
  }

  async cleanup_4() {
    await Promise.all([
      rmdir(this.processingTmpDirectory),
      rmdir(this.zipTmpDirectory),
    ]);
  }

  private async getZipContent(): Promise<{
    componentCoverageFiles: { componentName: string; file: string }[];
    aggregatedCoverageSummary: { file: string };
  }> {
    const files = await readdir(this.processingTmpDirectory);
    const componentCoverageFiles: { componentName: string; file: string }[] =
      [];
    for (const file of files) {
      if (file === "default.json") {
        componentCoverageFiles.push({
          componentName: file,
          file: join(this.processingTmpDirectory, file),
        });
        continue;
      }
      if (file === "_aggregated-coverage-summary.json") {
        // do nothing
        continue;
      }

      componentCoverageFiles.push({
        componentName: file,
        file: join(this.processingTmpDirectory, file),
      });
    }

    return {
      componentCoverageFiles,
      aggregatedCoverageSummary: {
        file: join(
          this.processingTmpDirectory,
          "_aggregated-coverage-summary.json"
        ),
      },
    };
  }
}

export const onCoverageUpload = onObjectFinalized(
  { memory: "256MiB" },
  async (event) => {
    const gcsBucketFilePath = event.data.name;
    const contentType = event.data.contentType;
    logger.info({ contentType, gcsBucketFilePath });
    if (
      !gcsBucketFilePath.startsWith("coverages/repo") ||
      !gcsBucketFilePath.endsWith(".zip")
    ) {
      logger.info(
        `Uploaded file not meant for processing as it is not a coverage upload (${gcsBucketFilePath})`
      );
      return;
    }

    const coverageZip = new CoverageZip(gcsBucketFilePath);

    try {
      await coverageZip.download_1();
      await coverageZip.unzip_2();
      await coverageZip.saveContentToFirestore_3();
    } catch (error) {
      logger.error(error);
    } finally {
      await coverageZip.cleanup_4();
    }
  }
);

// --- do not edit --- taken from coverage-uploader-action
// todo: make common package

export interface JSONSummary {
  total: FullCoverage;
  [file: string]: FullCoverage;
}

export interface FullCoverage {
  lines: CoverageObject;
  statements: CoverageObject;
  functions: CoverageObject;
  branches: CoverageObject;
  branchesTrue: CoverageObject;
}

export interface CoverageObject {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}
