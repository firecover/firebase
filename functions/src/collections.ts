import { firestore } from "./init";

const repositoryCollection = firestore.collection("repositories");

/** Doc: `repositories/{repositoryId}` */
export function repositoryDoc({
  repositoryId,
}: {
  repositoryId: string | null;
}) {
  return repositoryId
    ? repositoryCollection.doc(repositoryId)
    : repositoryCollection.doc();
}

/** Doc `repositories/{repositoryId}/git_refs/{gitRef}` */
export function gitRefDoc({
  repositoryId,
  gitRef,
}: {
  repositoryId: string;
  gitRef: string;
}) {
  return repositoryDoc({ repositoryId }).collection("git_refs").doc(gitRef);
}

/** Doc `repositories/{repositoryId}/git_refs/{gitRef}/comments/{commentId}` */
export function commentDoc({
  repositoryId,
  gitRef,
  commentId,
}: {
  repositoryId: string;
  gitRef: string;
  commentId: string | null;
}) {
  const commentCollection = gitRefDoc({ repositoryId, gitRef }).collection(
    "comments"
  );
  return commentId ? commentCollection.doc(commentId) : commentCollection.doc();
}

/** Doc `repositories/{repositoryId}/git_refs/{gitRef}/coverage/{coverageUploadId}` */
export function gitRefCoverageDoc({
  repositoryId,
  gitRef,
  coverageUploadId,
}: {
  repositoryId: string;
  gitRef: string;
  coverageUploadId: string | null;
}) {
  const coverageCollection = gitRefDoc({ repositoryId, gitRef }).collection(
    "coverages"
  );
  return coverageUploadId
    ? coverageCollection.doc(coverageUploadId)
    : coverageCollection.doc();
}

/** Doc `repositories/{repositoryId}/git_refs/{gitRef}/coverage/{coverageUploadId}/components/{componentId}` */
export function componentCoverageDoc({
  repositoryId,
  gitRef,
  coverageUploadId,
  componentId,
}: {
  repositoryId: string;
  gitRef: string;
  coverageUploadId: string;
  componentId: string;
}) {
  return gitRefCoverageDoc({ repositoryId, gitRef, coverageUploadId })
    .collection("components")
    .doc(componentId);
}

/** Doc `repositories/{repositoryId}/git_refs/{gitRef}/coverage/{coverageUploadId}/summary/"summary"` */
export function coverageSummaryDoc({
  repositoryId,
  gitRef,
  coverageUploadId,
}: {
  repositoryId: string;
  gitRef: string;
  coverageUploadId: string;
}) {
  return gitRefCoverageDoc({ repositoryId, gitRef, coverageUploadId })
    .collection("summary")
    .doc("summary");
}
