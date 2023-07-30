import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { decodeGitRef, encodeGitRef } from "./utils";
import * as logger from "firebase-functions/logger";
import {
  RepositoryDoc,
  commentDoc,
  componentCoverageCollection,
  coverageSummaryDoc,
  gitRefCoverageCollection,
  repositoryDoc,
} from "./collections";
import { FullCoverage, JSONSummary } from "./on-coverage-upload";

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

    if (!sourceCoverage) {
      throw new Error(
        "Source coverage missing " +
          repositoryId +
          "/" +
          encodedGitRef +
          "/" +
          uploadId
      );
    }

    const totalSummaryDiff = compareAndGetStatusOfSourceCoverage({
      sourceCoverage: sourceCoverage.summary,
      targetCoverage: targetCoverage?.summary,
    });

    if (totalSummaryDiff.diffAccumulation === 0) {
      await commentDoc({
        repositoryId,
        gitRef: encodedGitRef,
      }).set({
        updatedAt: new Date(),
        totalSummaryDiff: totalSummaryDiff.difference,
        componentsCoverageDiff: null,
        componentWiseFileCoverageDiff: null,
      });
      return;
    }

    const targetComponentIdComponentMapping = new Map(
      targetCoverage?.components.map((component) => [
        component.componentId,
        component.coverage,
      ])
    );

    const componentsCoverageDiff = sourceCoverage.components
      .map((component) => {
        const componentCoverageDiff = compareAndGetStatusOfSourceCoverage({
          sourceCoverage: component.coverage.total,
          targetCoverage: targetComponentIdComponentMapping.get(
            component.componentId
          )?.total,
        });
        if (componentCoverageDiff.diffAccumulation === 0) {
          return;
        }
        return {
          componentId: component.componentId,
          componentCoverageDiff: componentCoverageDiff.difference,
        };
      })
      .filter(
        (
          item
        ): item is {
          componentId: string;
          componentCoverageDiff: Record<keyof FullCoverage, number>;
        } => Boolean(item)
      );

    const componentWiseFileCoverageDiff = sourceCoverage.components?.map(
      (component) => {
        const targetComponentSummary = targetComponentIdComponentMapping.get(
          component.componentId
        );
        if (!targetComponentSummary) {
          throw new Error("todo");
        }

        const targetFileToCoverageMapping = new Map(
          Object.entries(targetComponentSummary)
        );

        const fileCoverageDiff = Object.keys(component.coverage)
          .map((file) => {
            const diff = compareAndGetStatusOfSourceCoverage({
              sourceCoverage: component.coverage[file],
              targetCoverage: targetFileToCoverageMapping.get(file),
            });

            if (diff.diffAccumulation === 0) {
              return;
            }
            return { file, diff: diff.difference };
          })
          .filter(
            (
              item
            ): item is {
              file: string;
              diff: Record<keyof FullCoverage, number>;
            } => Boolean(item)
          );

        return { componentId: component.componentId, fileCoverageDiff };
      }
    );

    await commentDoc({
      repositoryId,
      gitRef: encodedGitRef,
    }).set({
      updatedAt: new Date(),
      totalSummaryDiff: totalSummaryDiff.difference,
      componentsCoverageDiff,
      componentWiseFileCoverageDiff,
    });
  }
);

function compareAndGetStatusOfSourceCoverage({
  sourceCoverage,
  targetCoverage,
}: {
  sourceCoverage: FullCoverage;
  targetCoverage?: FullCoverage;
}) {
  let diffAccumulation = 0;

  function getDiff(type: keyof FullCoverage) {
    const diff =
      sourceCoverage[type].pct -
      (targetCoverage ? targetCoverage[type].pct : 0);
    diffAccumulation += Math.abs(diff);
    return diff;
  }

  const difference: Record<keyof FullCoverage, number> = {
    branches: getDiff("branches"),
    branchesTrue: getDiff("branchesTrue"),
    functions: getDiff("functions"),
    lines: getDiff("lines"),
    statements: getDiff("statements"),
  };

  return { difference, diffAccumulation };
}

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
