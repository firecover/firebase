import { onObjectFinalized } from "firebase-functions/v2/storage";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirp } from "mkdirp";
import { bucket } from "./init";
import * as Zip from "adm-zip";
import { readdir } from "node:fs/promises";

class CoverageZip {
  private readonly processingTmpDirectory;
  private readonly zipTmpDirectory;
  private readonly zipFileLocation: string;

  constructor(private readonly gcsFilePath: string) {
    const osTmpDirectory = tmpdir();
    const uploadId = this.getIdFromGCSPath(gcsFilePath);
    this.processingTmpDirectory = join(osTmpDirectory, "process-" + uploadId);
    this.zipTmpDirectory = join(osTmpDirectory, "zip-" + uploadId);
    this.zipFileLocation = join(this.zipTmpDirectory, "compressed.zip");
  }

  public async download() {
    await mkdirp(this.zipTmpDirectory);
    await bucket
      .file(this.gcsFilePath)
      .download({ destination: this.zipFileLocation });
  }

  public async unzip(zipFileLocation = this.zipFileLocation) {
    await mkdirp(this.processingTmpDirectory);
    await new Promise((resolve, reject) => {
      const zip = new Zip(zipFileLocation);
      zip.extractAllToAsync(this.processingTmpDirectory, true, false, (err) => {
        if (err) return reject(err);
        resolve(null);
      });
    });
  }

  private async getZipContent(): Promise<{
    componentCoverageFiles: string[];
    aggregatedCoverageSummary: string;
  }> {
    const files = await readdir(this.processingTmpDirectory);
    const componentCoverageFiles: string[] = [];
    for (const file of files) {
      if (file === "default.json") {
        componentCoverageFiles.push(file);
        continue;
      }
      if (file === "_aggregated-coverage-summary.json") {
        // do nothing
        continue;
      }

      componentCoverageFiles.push(file);
    }

    return {
      componentCoverageFiles,
      aggregatedCoverageSummary: "_aggregated-coverage-summary.json",
    };
  }

  private getIdFromGCSPath(gcsFilePath: string): string {}
}

export const onCoverageUpload = onObjectFinalized(
  { memory: "256MiB" },
  () => {}
);
