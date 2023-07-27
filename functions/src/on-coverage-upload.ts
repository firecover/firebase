import { onObjectFinalized } from "firebase-functions/v2/storage";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirp } from "mkdirp";
import { bucket } from "./init";
import * as Zip from "adm-zip";

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

  private async getFileContent() {}

  private getIdFromGCSPath(gcsFilePath: string): string {}
}

export const onCoverageUpload = onObjectFinalized(
  { memory: "256MiB" },
  () => {}
);
