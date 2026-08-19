import { describe, expect, test } from "bun:test";
import { productionDeploymentApproval, releaseApproverIds } from "./approve-production-deployment";

const reviewedSha = "reviewed";
const releaseSha = "release";
const base = {
  current_user_id: 1345402,
  local_sha: releaseSha,
  main_sha: releaseSha,
  run: { event: "push", path: ".github/workflows/deploy.yml", head_branch: "v0.1.0", head_sha: releaseSha, actor: { id: 280144521 } },
  pulls: [[{ base: { ref: "main" }, head: { sha: reviewedSha }, merged_at: "2026-08-19T00:00:00Z", merge_commit_sha: releaseSha }]],
  check_run_pages: [{ check_runs: [
    { name: "typecheck", conclusion: "success", app: { id: 15368 } },
    { name: "base-controlled samorev publisher", conclusion: "success", app: { id: 15368 } },
  ] }],
  action_run_pages: [{ workflow_runs: [
    { path: ".github/workflows/ci.yml", event: "pull_request", head_sha: reviewedSha, conclusion: "success", pull_requests: [] },
    { path: ".github/workflows/samorev-gate.yml", event: "pull_request_target", head_sha: reviewedSha, conclusion: "success", pull_requests: [{ head: { sha: reviewedSha } }] },
  ] }],
  status_pages: [[
    { id: 1, context: "samorev", state: "failure", created_at: "2026-08-19T00:00:00Z", creator: { id: 280144521 } },
    { id: 2, context: "samorev", state: "success", created_at: "2026-08-19T00:01:00Z", creator: { id: 280144521 } },
    { id: 3, context: "samorev-gate", state: "success", created_at: "2026-08-19T00:02:00Z", creator: { id: 41898282 } },
  ]],
  pending_deployments: [{ environment: { id: 19965704930, name: "production" }, current_user_can_approve: true }],
};

describe("production deployment approval", () => {
  test("matches the complete GitHub production reviewer set", async () => {
    const policy = JSON.parse(await Bun.file("config/production-environment.json").text()) as {
      reviewers: Array<{ id: number }>;
    };
    expect(policy.reviewers.map(({ id }) => id).sort()).toEqual([...releaseApproverIds].sort());
  });

  test("accepts an exact reviewed release for the separate approval identity", () => {
    expect(productionDeploymentApproval(base)).toEqual({ environmentId: 19965704930, reviewedSha });
  });

  test("rejects an Actions-forged latest samorev context", () => {
    const forged = structuredClone(base);
    forged.status_pages[0].push({
      id: 4,
      context: "samorev",
      state: "success",
      created_at: "2026-08-19T00:03:00Z",
      creator: { id: 41898282 },
    });
    expect(() => productionDeploymentApproval(forged)).toThrow("immutable successful reviewer identity");
  });

  test("rejects a non-Actions gate publisher", () => {
    const forged = structuredClone(base);
    forged.status_pages[0][2].creator.id = 1;
    expect(() => productionDeploymentApproval(forged)).toThrow("expected Actions identity");
  });

  test("rejects a different workflow and a non-exact checkout", () => {
    expect(() => productionDeploymentApproval({ ...base, run: { ...base.run, path: ".github/workflows/evil.yml" } }))
      .toThrow("not the tag deploy workflow");
    expect(() => productionDeploymentApproval({ ...base, local_sha: "stale" })).toThrow("are not exact");
  });

  test("rejects approval by the release actor", () => {
    expect(() => productionDeploymentApproval({ ...base, run: { ...base.run, actor: { id: 1345402 } } }))
      .toThrow("release actor cannot approve their own production deployment");
  });

  test("rejects an untrusted approver and non-production request", () => {
    expect(() => productionDeploymentApproval({ ...base, current_user_id: 1 })).toThrow("configured production reviewer identity");
    expect(() => productionDeploymentApproval({ ...base, pending_deployments: [{ environment: { id: 1, name: "staging" }, current_user_can_approve: true }] }))
      .toThrow("not the production environment");
  });
});
