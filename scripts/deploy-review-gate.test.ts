import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("deploy review revalidation", () => {
  test("binds release to exact workflow paths and the immutable reviewer", async () => {
    const workflow = await Bun.file(".github/workflows/deploy.yml").text();
    const gate = await Bun.file("scripts/check-release-review-evidence.sh").text();
    const codeowners = await Bun.file(".github/CODEOWNERS").text();
    const documentation = await Bun.file("docs/review-gate.md").text();
    expect(workflow).toContain('bash scripts/check-release-review-evidence.sh "$reviewed_sha"');
    expect(workflow).not.toContain('/reviews\")');
    expect(workflow).not.toContain('.state == "APPROVED"');
    expect(gate).toContain('actions/workflows/ci.yml/runs?event=pull_request&head_sha=$reviewed_sha');
    expect(gate).toContain('actions/workflows/samorev-gate.yml/runs?event=pull_request_target&head_sha=$reviewed_sha');
    expect(gate).toContain('.default_branch == "main"');
    expect(gate).toContain('.enforce_admins.enabled == true');
    expect(gate).toContain('.allow_force_pushes.enabled == false');
    expect(gate).toContain('.require_last_push_approval == true');
    expect(gate).toContain('.path == ".github/workflows/ci.yml"');
    expect(gate).toContain('.path == ".github/workflows/samorev-gate.yml"');
    expect(gate).toContain('.base.ref == "main"');
    expect(gate).toContain('.head_repository.full_name == $repository');
    expect(gate).toContain('.target_url == $publisher_url');
    expect(gate).toContain("sort_by(.created_at, .id) | last");
    expect(gate).toContain('.creator.id == 280144521');
    expect(gate).not.toContain('.creator.login == "samo-agent"');
    expect(codeowners.trim()).toBe("* @samo-agent");
    expect(documentation).toContain("every changed enforcement script under\n`scripts/check-*.sh`");
    expect(documentation).toContain("Actions bot's immutable ID, not `280144521`");
    const reviewGate = workflow.slice(workflow.indexOf("  review-gate:"), workflow.indexOf("\n  deploy:"));
    const deploy = workflow.slice(workflow.indexOf("\n  deploy:"));
    expect(reviewGate).toContain("actions: read");
    expect(reviewGate).toContain("pull-requests: read");
    expect(reviewGate).toContain("statuses: read");
    expect(reviewGate).toContain("actions/checkout@11d5960a326750d5838078e36cf38b85af677262");
    expect(reviewGate).toContain("persist-credentials: false");
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
  repos/example/gitzette)
    default_branch=main; [[ "$mode" != wrong-default ]] || default_branch=attacker
    jq -nc --arg default_branch "$default_branch" '{default_branch:$default_branch}'
    ;;
  repos/example/gitzette/branches/main/protection)
    enforce=true; force=false; delete=false; reviews=true
    [[ "$mode" != admin-bypass ]] || enforce=false
    [[ "$mode" != force-push ]] || force=true
    [[ "$mode" != deletable-main ]] || delete=true
    [[ "$mode" != no-reviews ]] || reviews=false
    jq -nc --argjson enforce "$enforce" --argjson force "$force" --argjson delete "$delete" --argjson reviews "$reviews" '{enforce_admins:{enabled:$enforce},allow_force_pushes:{enabled:$force},allow_deletions:{enabled:$delete},required_pull_request_reviews:(if $reviews then {dismiss_stale_reviews:true,require_code_owner_reviews:true,require_last_push_approval:true} else null end)}'
    ;;
  *rulesets*)
    if [[ "$mode" == ruleset ]]; then printf '[{"id":1}]\n'; else printf '[]\n'; fi
    ;;
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
      base=main; [[ "$mode" != wrong-base ]] || base=attacker
      repository=example/gitzette; [[ "$mode" != fork-head ]] || repository=attacker/gitzette
      jq -nc --arg sha "$FAKE_SHA" --arg latest "$latest" --arg base "$base" --arg repository "$repository" '{workflow_runs:[
        {id:1,path:".github/workflows/samorev-gate.yml",event:"pull_request_target",head_sha:$sha,created_at:"2026-01-01T00:00:00Z",run_started_at:"2026-01-01T00:00:00Z",html_url:"https://github.com/example/gitzette/actions/runs/1",conclusion:"success",head_repository:{full_name:"example/gitzette"},pull_requests:[{base:{ref:"main",repo:{url:"https://api.github.com/repos/example/gitzette"}},head:{sha:$sha,repo:{url:"https://api.github.com/repos/example/gitzette"}}}]},
        {id:2,path:".github/workflows/samorev-gate.yml",event:"pull_request_target",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",run_started_at:"2026-01-02T00:00:00Z",html_url:"https://github.com/example/gitzette/actions/runs/2",conclusion:$latest,head_repository:{full_name:$repository},pull_requests:[{base:{ref:$base,repo:{url:"https://api.github.com/repos/example/gitzette"}},head:{sha:$sha,repo:{url:("https://api.github.com/repos/" + $repository)}}}]}]}'
    fi
    ;;
  *statuses*)
    latest_state=success; latest_id=280144521; latest_login=samo-agent
    if [[ "$mode" == latest-review-failure ]]; then latest_state=failure; fi
    if [[ "$mode" == forged-reviewer ]]; then latest_id=1; latest_login=attacker; fi
    if [[ "$mode" == renamed-reviewer ]]; then latest_login=renamed-samo; fi
    target=https://github.com/example/gitzette/actions/runs/2
    [[ "$mode" != wrong-publisher-target ]] || target=https://github.com/example/gitzette/actions/runs/1
    created_at=2026-01-03T00:00:00Z; [[ "$mode" != predated-verdict ]] || created_at=2026-01-01T00:00:00Z
    jq -nc --arg state "$latest_state" --argjson actor "$latest_id" --arg login "$latest_login" --arg target "$target" --arg created_at "$created_at" '[
      {id:1,context:"samorev",state:"success",created_at:"2026-01-01T00:00:00Z",target_url:"https://github.com/example/gitzette/actions/runs/1",creator:{id:280144521,login:"samo-agent"}},
      {id:2,context:"samorev",state:$state,created_at:$created_at,target_url:$target,creator:{id:$actor,login:$login}}]'
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
      "latest-review-failure", "forged-reviewer", "wrong-default", "admin-bypass",
      "force-push", "deletable-main", "no-reviews", "ruleset",
      "wrong-base", "fork-head", "wrong-publisher-target", "predated-verdict", "api-error",
    ]) expect(await run(mode)).not.toBe(0);
  });
});
