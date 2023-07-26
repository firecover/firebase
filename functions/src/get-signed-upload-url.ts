import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { bucket } from "./init";
import { GetSignedUrlConfig } from "@google-cloud/storage";

export const getSingedUploadURL = onRequest(async (request, response) => {
  const payload = request.body;
  logger.info(payload);

  const url = await generateSignedUrl("/test", 100);
  response.send({ url });
});

async function generateSignedUrl(filePath: string, expiresInSeconds: number) {
  const options: GetSignedUrlConfig = {
    version: "v4",
    action: "write",
    expires: new Date(Date.now() + expiresInSeconds * 1000),
  };

  const [url] = await bucket.file(filePath).getSignedUrl(options);
  return url;
}
