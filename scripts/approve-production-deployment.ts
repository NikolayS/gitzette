import { array, record, releaseReview } from "./check-release-review";

const ownerId = 1345402;
export const releaseApproverIds = new Set([ownerId]);

export function productionDeploymentApproval(document: unknown): { environmentId: number; reviewedSha: string } {
  const input = record(document, "approval document");
  if (typeof input.current_user_id !== "number" || !releaseApproverIds.has(input.current_user_id)) {
    throw new Error("release approval requires a configured production reviewer identity");
  }
  if (typeof input.local_sha !== "string" || input.local_sha.length === 0) throw new Error("local SHA is missing");
  if (typeof input.main_sha !== "string" || input.main_sha.length === 0) throw new Error("main SHA is missing");

  const run = record(input.run, "workflow run");
  const runActor = record(run.actor, "workflow run actor");
  if (typeof runActor.id !== "number") throw new Error("workflow run actor ID is missing");
  if (runActor.id === input.current_user_id) {
    throw new Error("release actor cannot approve their own production deployment");
  }
  if (run.event !== "push" || run.path !== ".github/workflows/deploy.yml") {
    throw new Error("deployment request is not the tag deploy workflow");
  }
  if (typeof run.head_branch !== "string" || !/^v[^/]*$/.test(run.head_branch)) {
    throw new Error("deployment request is not for a v* tag");
  }
  if (run.head_sha !== input.main_sha || run.head_sha !== input.local_sha) {
    throw new Error("deployment tag, current main, and clean local checkout are not exact");
  }

  const { reviewedSha } = releaseReview({ ...input, release_sha: run.head_sha });

  const pending = array(input.pending_deployments, "pending deployments").map((item) => record(item, "pending deployment"));
  if (pending.length !== 1) throw new Error("expected exactly one pending production deployment");
  const environment = record(pending[0].environment, "pending environment");
  if (environment.name !== "production" || typeof environment.id !== "number") {
    throw new Error("pending deployment is not the production environment");
  }
  if (pending[0].current_user_can_approve !== true) throw new Error("current reviewer cannot approve this production deployment");
  return { environmentId: environment.id, reviewedSha };
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("approval document path is required");
  const document = JSON.parse(await Bun.file(path).text());
  process.stdout.write(`${JSON.stringify(productionDeploymentApproval(document))}\n`);
}
