import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { bucket, firestore } from "./init";
import { GetSignedUrlConfig } from "@google-cloud/storage";

export const getSingedUploadURL = onRequest(
  {
    memory: "128MiB",
  },
  async (request, response) => {
    const { token, ref } = request.body as { token?: string; ref?: string };
    logger.info(JSON.stringify({ token, ref }, null, 2));

    if (!token || !ref) {
      response.status(422).json({ message: "invalid token/ref" });
      return;
    }

    const repoDoc = await firestore.collection("repository").doc(token).get();
    if (!repoDoc.exists) {
      response.status(422).json({ message: "repo not configured" });
      return;
    }

    const coverageReferenceDoc = repoDoc.ref
      .collection("coverage-upload-references")
      .doc();

    const uploadRefDocCreateTask = coverageReferenceDoc.create({
      createdAt: new Date(),
      ref,
      state: "created",
    });

    const generateSignedUrlTask = generateSignedUrl(
      `coverages/repo_${repoDoc.id}/${ref}/${coverageReferenceDoc.id}.zip`,
      5 * 60
    );

    const [url] = await Promise.all([
      generateSignedUrlTask,
      uploadRefDocCreateTask,
    ]);

    response.send({ url });
  }
);

async function generateSignedUrl(filePath: string, expiresInSeconds: number) {
  const options: GetSignedUrlConfig = {
    version: "v4",
    action: "write",
    expires: new Date(Date.now() + expiresInSeconds * 1000),
  };

  const [url] = await bucket.file(filePath).getSignedUrl(options);
  return url;
}
