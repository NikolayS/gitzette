import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("deploy review revalidation", () => {
  test("binds release to exact workflow paths and the immutable reviewer", async () => {
    const workflow = await Bun.file(".github/workflows/deploy.yml").text();
    const gate = await Bun.file("scripts/check-release-review-evidence.sh").text();
    expect(workflow).toContain('bash scripts/check-release-review-evidence.sh "$reviewed_sha"');
    expect(workflow).not.toContain('/reviews\")');
    expect(workflow).not.toContain('.state == "APPROVED"');
    expect(gate).toContain('actions/workflows/ci.yml/runs?event=pull_request&head_sha=$reviewed_sha');
    expect(gate).toContain('actions/workflows/samorev-gate.yml/runs?event=pull_request_target&head_sha=$reviewed_sha');
    expect(gate).toContain('.path == ".github/workflows/ci.yml"');
    expect(gate).toContain('.path == ".github/workflows/samorev-gate.yml"');
    expect(gate).toContain("sort_by(.created_at, .id) | last");
    expect(gate).toContain('.creator.id == 280144521');
    expect(gate).not.toContain('.creator.login == "samo-agent"');
    const reviewGate = workflow.slice(workflow.indexOf("  review-gate:"), workflow.indexOf("\n  deploy:"));
    const deploy = workflow.slice(workflow.indexOf("\n  deploy:"));
    expect(reviewGate).toContain("actions: read");
    expect(reviewGate).toContain("pull-requests: read");
    expect(reviewGate).toContain("statuses: read");
    expect(deploy).toContain("needs: review-gate");
    expect(deploy).toContain("contents: read");
    expect(deploy).not.toContain("actions: read");
    expect(deploy).not.toContain("pull-requests: read");
    expect(deploy).not.toContain("statuses: read");
  });

  test("fails closed on stale, forged, or failed latest evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-release-evidence-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const gh = join(bin, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
endpoint="\${*: -1}"
mode="\${FAKE_MODE:-success}"
if [[ "$mode" == api-error ]]; then echo "fake API failure" >&2; exit 1; fi
case "$endpoint" in
  *actions/workflows/ci.yml/runs*)
    if [[ "$mode" == no-ci-path ]]; then
      jq -nc --arg sha "$FAKE_SHA" '{workflow_runs:[{id:2,path:".github/workflows/attacker.yml",event:"pull_request",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",conclusion:"success"}]}'
    else
      latest=success; [[ "$mode" != latest-ci-failure ]] || latest=failure
      jq -nc --arg sha "$FAKE_SHA" --arg latest "$latest" '{workflow_runs:[
        {id:1,path:".github/workflows/ci.yml",event:"pull_request",head_sha:$sha,created_at:"2026-01-01T00:00:00Z",conclusion:"success"},
        {id:2,path:".github/workflows/ci.yml",event:"pull_request",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",conclusion:$latest}]}'
    fi
    ;;
  *actions/workflows/samorev-gate.yml/runs*)
    if [[ "$mode" == no-gate-path ]]; then
      jq -nc --arg sha "$FAKE_SHA" '{workflow_runs:[{id:2,path:".github/workflows/attacker.yml",event:"pull_request_target",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",conclusion:"success"}]}'
    else
      latest=success; [[ "$mode" != latest-gate-failure ]] || latest=failure
      jq -nc --arg sha "$FAKE_SHA" --arg latest "$latest" '{workflow_runs:[
        {id:1,path:".github/workflows/samorev-gate.yml",event:"pull_request_target",head_sha:$sha,created_at:"2026-01-01T00:00:00Z",conclusion:"success"},
        {id:2,path:".github/workflows/samorev-gate.yml",event:"pull_request_target",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",conclusion:$latest}]}'
    fi
    ;;
  *statuses*)
    latest_state=success; latest_id=280144521; latest_login=samo-agent
    if [[ "$mode" == latest-review-failure ]]; then latest_state=failure; fi
    if [[ "$mode" == forged-reviewer ]]; then latest_id=1; latest_login=attacker; fi
    if [[ "$mode" == renamed-reviewer ]]; then latest_login=renamed-samo; fi
    jq -nc --arg state "$latest_state" --argjson actor "$latest_id" --arg login "$latest_login" '[
      {id:1,context:"samorev",state:"success",created_at:"2026-01-01T00:00:00Z",creator:{id:280144521,login:"samo-agent"}},
      {id:2,context:"samorev",state:$state,created_at:"2026-01-02T00:00:00Z",creator:{id:$actor,login:$login}}]'
    ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const sha = "a".repeat(40);
    const run = (mode: string): Promise<number> => Bun.spawn([
      "bash", "scripts/check-release-review-evidence.sh", sha,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: mode, FAKE_SHA: sha },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await run("success")).toBe(0);
    expect(await run("renamed-reviewer")).toBe(0);
    for (const mode of [
      "latest-ci-failure", "no-ci-path", "latest-gate-failure", "no-gate-path",
      "latest-review-failure", "forged-reviewer", "api-error",
    ]) expect(await run(mode)).not.toBe(0);
  });
});
