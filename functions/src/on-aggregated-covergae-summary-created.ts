import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { decodeGitRef, encodeGitRef } from "./utils";
import * as logger from "firebase-functions/logger";
import {
  RepositoryDoc,
  componentCoverageCollection,
  coverageSummaryDoc,
  repositoryDoc,
} from "./collections";

export const onAggregatedCoverageSummaryCreated = onDocumentCreated(
  "repositories/{repositoryId}/git_refs/{gitRef}/coverage/{coverageUploadId}/summary/summary",
  async (fireEvent) => {
    const encodedGitRef = fireEvent.params.gitRef;
    const repositoryId = fireEvent.params.repositoryId;
    const uploadId = fireEvent.params.coverageUploadId;

    const gitRef = decodeGitRef(encodedGitRef);

    const pullNumber = getPullRequestNumberFromRef(gitRef);

    if (!pullNumber) {
      logger.info(`Aborting: ${gitRef} is not a pull request`);
      return;
    }

    const repoDoc = await repositoryDoc({ repositoryId }).get();
    if (!repoDoc.exists) {
      throw new Error("repository does not exist");
    }
    const repoData = repoDoc.data() as RepositoryDoc;

    const targetRef = await getTargetRefToCompare(repoData.name, pullNumber);

    const coverageOfTargetRefTask = getLatestCoverageOfRef(
      encodeGitRef(targetRef)
    );
    const coverageOfSourceRefTask = getLatestCoverageOfRef(encodedGitRef);

    const [targetCoverage, sourceCoverage] = await Promise.all([
      coverageOfTargetRefTask,
      coverageOfSourceRefTask,
    ]);
  }
);

async function getTargetRefToCompare(
  repoName: string,
  pullNumber: number
): Promise<string> {
  const getPrDetailsApiUrl = `https://api.github.com/repos/${repoName}/pulls/${pullNumber}`;
  const response = await fetch(getPrDetailsApiUrl);
  const responseJson = await response.json();
  const targetRef = responseJson?.base?.ref;

  if (!targetRef) {
    const message = "Unable to get target ref from github api";
    logger.error(message, responseJson);
    throw new Error(message);
  }
  return targetRef;
}

function getPullRequestNumberFromRef(decodedGitRef: string): number | null {
  if (!decodedGitRef.includes("/pull/")) {
    return null;
  }
  return 5;
}

async function getLatestCoverageOfRef(
  repositoryId: string,
  encodedRef: string,
  uploadId?: string
) {
  if (!uploadId) {
    throw new Error("tood");
  }

  const getSummaryDocTask = coverageSummaryDoc({
    repositoryId,
    coverageUploadId: uploadId,
    gitRef: encodedRef,
  }).get();

  componentCoverageCollection;
}
