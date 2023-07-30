import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { decodeGitRef, encodeGitRef } from "./utils";
import * as logger from "firebase-functions/logger";
import {
  RepositoryDoc,
  componentCoverageCollection,
  coverageSummaryDoc,
  gitRefCoverageCollection,
  repositoryDoc,
} from "./collections";
import { JSONSummary } from "./on-coverage-upload";

export const onAggregatedCoverageSummaryCreated = onDocumentCreated(
  "repositories/{repositoryId}/git_refs/{gitRef}/coverage/{coverageUploadId}/summary/summary",
  async (fireEvent) => {
    const encodedGitRef = fireEvent.params.gitRef;
    const repositoryId = fireEvent.params.repositoryId;
    const uploadId = fireEvent.params.coverageUploadId;

    const decodedGitRef = decodeGitRef(encodedGitRef);

    const pullNumber = getPullRequestNumberFromRef(decodedGitRef);

    if (!pullNumber) {
      logger.info(`Aborting: ${decodedGitRef} is not a pull request`);
      return;
    }

    const repoDoc = await repositoryDoc({ repositoryId }).get();
    if (!repoDoc.exists) {
      throw new Error("repository does not exist");
    }
    const repoData = repoDoc.data() as RepositoryDoc;

    const targetRefDecoded = await getTargetRefToCompare(
      repoData.name,
      pullNumber
    );

    const coverageOfTargetRefTask = getLatestCoverageOfRef({
      repositoryId,
      encodedRef: encodeGitRef(targetRefDecoded),
    });
    const coverageOfSourceRefTask = getLatestCoverageOfRef({
      repositoryId,
      encodedRef: encodedGitRef,
      uploadId,
    });

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

async function getLatestCoverageOfRef({
  repositoryId,
  encodedRef,
  uploadId,
}: {
  repositoryId: string;
  encodedRef: string;
  uploadId?: string;
}) {
  uploadId =
    uploadId ?? (await getLatestUploadIdOfRef({ repositoryId, encodedRef }));
  if (!uploadId) {
    return;
  }

  const getSummaryDocTask = coverageSummaryDoc({
    repositoryId,
    coverageUploadId: uploadId,
    gitRef: encodedRef,
  }).get();

  const componentCoverageGetTask = componentCoverageCollection({
    repositoryId,
    gitRef: encodedRef,
    coverageUploadId: uploadId,
  }).get();

  const [summaryDoc, componentCoverages] = await Promise.all([
    getSummaryDocTask,
    componentCoverageGetTask,
  ]);

  const summaryDocData = summaryDoc.data() as
    | { coverage: JSONSummary }
    | undefined;
  if (!summaryDocData) return;

  const coverage = {
    summary: summaryDocData.coverage.total,
    components: componentCoverages.docs.map((doc) => ({
      componentId: doc.id,
      coverage: (doc.data() as { coverage: JSONSummary }).coverage,
    })),
  };

  return coverage;
}

async function getLatestUploadIdOfRef({
  repositoryId,
  encodedRef,
}: {
  repositoryId: string;
  encodedRef: string;
}) {
  const latestRecordResponse = await gitRefCoverageCollection({
    repositoryId,
    gitRef: encodedRef,
  })
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (latestRecordResponse.empty) {
    return;
  }

  return latestRecordResponse.docs[0].id;
}