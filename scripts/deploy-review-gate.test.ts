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
    const branchPolicy = JSON.parse(await Bun.file("config/main-branch-protection.json").text());
    const applyBranchPolicy = await Bun.file("scripts/apply-branch-protection.sh").text();
    const reviewerWrapper = await Bun.file("scripts/run-samorev-review.sh").text();
    const tagActorGate = "scripts/check-release-tag-actor.sh";
    expect(workflow).toContain('bash scripts/check-release-review-evidence.sh "$reviewed_sha"');
    expect(workflow).toContain("TAG_PUSHER_ID: ${{ github.actor_id }}");
    expect(workflow).toContain('bash scripts/check-release-tag-actor.sh "$TAG_PUSHER_ID"');
    expect(workflow).not.toContain('/reviews\")');
    expect(workflow).not.toContain('.state == "APPROVED"');
    expect(gate).toContain('actions/workflows/ci.yml/runs?event=pull_request&head_sha=$reviewed_sha');
    expect(gate).toContain('actions/workflows/samorev-gate.yml/runs?event=pull_request_target&head_sha=$reviewed_sha');
    expect(gate).toContain('.path == ".github/workflows/ci.yml"');
    expect(gate).toContain('.path == ".github/workflows/samorev-gate.yml"');
    expect(gate).toContain('.base.ref == "main"');
    expect(gate).toContain('.head_repository.full_name == $repository');
    expect(gate).toContain('.target_url == $publisher_url');
    expect(gate).toContain("sort_by(.created_at, .id) | last");
    expect(gate).toContain('.creator.id == 280144521');
    expect(gate).toContain("gh api --paginate --slurp");
    expect(gate).not.toContain('.creator.login == "samo-agent"');
    expect(codeowners.trim()).toBe("* @samo-agent");
    expect(branchPolicy.repository_rulesets).toEqual([{
      name: "main-admin-only-updates", target: "branch", enforcement: "active",
      bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
      conditions: { ref_name: { exclude: [], include: ["refs/heads/main"] } },
      rules: [{ type: "update", parameters: { update_allows_fetch_and_merge: false } }],
    }]);
    expect(branchPolicy.allow_auto_merge).toBe(false);
    expect(applyBranchPolicy).toContain("{allow_auto_merge}");
    expect(documentation).toContain("Repository auto-merge is disabled and audited");
    expect(documentation).toContain("scripts/run-samorev-review.sh");
    expect(reviewerWrapper).toContain("SAMOREV_IGNORED_GITHUB_CHECK_RUN_IDS");
    expect(reviewerWrapper).toContain("SAMOREV_IGNORED_GITHUB_CHECK_NAME");
    expect(reviewerWrapper).toContain("SAMOREV_IGNORED_GITHUB_CHECK_APP_ID=15368");
    expect(reviewerWrapper).toContain('-f target_url="$publisher_url"');
    expect(reviewerWrapper).toContain("publish error");
    expect(reviewerWrapper).toContain('>"$log_file" 2>&1');
    expect(reviewerWrapper).not.toContain('> >(tee "$log_file")');
    expect(applyBranchPolicy.indexOf("repository_rulesets | length")).toBeLessThan(
      applyBranchPolicy.indexOf("{allow_auto_merge}"),
    );
    expect(applyBranchPolicy.indexOf("trap audit_partial_apply EXIT")).toBeLessThan(
      applyBranchPolicy.indexOf("{allow_auto_merge}"),
    );
    expect(applyBranchPolicy.indexOf("ruleset_payload=")).toBeLessThan(
      applyBranchPolicy.indexOf("actions/permissions/workflow"),
    );
    expect(applyBranchPolicy).toContain("current_user_can_bypass");
    expect(documentation).toContain("every changed enforcement script under\n`scripts/check-*.sh`");
    expect(documentation).toContain("Actions bot's immutable ID, not `280144521`");
    expect(documentation).toContain("GitHub Actions is not a bypass actor");
    const runTagActorGate = (actor?: string): Promise<number> => Bun.spawn([
      "bash", tagActorGate, ...(actor === undefined ? [] : [actor]),
    ], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" }).exited;
    expect(await runTagActorGate("280144521")).toBe(0);
    expect(await runTagActorGate("1345402")).toBe(1);
    expect(await runTagActorGate("41898282")).toBe(1);
    expect(await runTagActorGate("")).toBe(1);
    expect(await runTagActorGate()).toBe(1);
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
  *actions/workflows/ci.yml/runs*)
    if [[ "$mode" == no-ci-path ]]; then
      jq -nc --arg sha "$FAKE_SHA" '{workflow_runs:[{id:2,path:".github/workflows/attacker.yml",event:"pull_request",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",conclusion:"success"}]}'
    else
      latest=success; [[ "$mode" != latest-ci-failure ]] || latest=failure
      base=main; [[ "$mode" != wrong-ci-base ]] || base=attacker
      repository=example/gitzette; [[ "$mode" != fork-ci-head ]] || repository=attacker/gitzette
      jq -nc --arg sha "$FAKE_SHA" --arg latest "$latest" --arg base "$base" --arg repository "$repository" '{workflow_runs:[
        {id:1,path:".github/workflows/ci.yml",event:"pull_request",head_sha:$sha,created_at:"2026-01-01T00:00:00Z",conclusion:"success",head_repository:{full_name:"example/gitzette"},pull_requests:[{base:{ref:"main",repo:{url:"https://api.github.com/repos/example/gitzette"}},head:{sha:$sha,repo:{url:"https://api.github.com/repos/example/gitzette"}}}]},
        {id:2,path:".github/workflows/ci.yml",event:"pull_request",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",conclusion:$latest,head_repository:{full_name:$repository},pull_requests:[{base:{ref:$base,repo:{url:"https://api.github.com/repos/example/gitzette"}},head:{sha:$sha,repo:{url:("https://api.github.com/repos/" + $repository)}}}]}]}'
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
    jq -nc --arg state "$latest_state" --argjson actor "$latest_id" --arg login "$latest_login" --arg target "$target" --arg created_at "$created_at" '[[
      {id:1,context:"samorev",state:"success",created_at:"2026-01-01T00:00:00Z",target_url:"https://github.com/example/gitzette/actions/runs/1",creator:{id:280144521,login:"samo-agent"}},
      {id:2,context:"samorev",state:$state,created_at:$created_at,target_url:$target,creator:{id:$actor,login:$login}}]]'
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
      "latest-review-failure", "forged-reviewer", "wrong-ci-base", "fork-ci-head",
      "wrong-base", "fork-head", "wrong-publisher-target", "predated-verdict", "api-error",
    ]) {
      const code = await run(mode);
      expect(code).not.toBe(0);
    }
  });

  test("keeps the external reviewer credential out of Actions secret stores", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-reviewer-isolation-"));
    const gh = join(root, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
endpoint="\${*: -1}"
case "$endpoint" in
  *collaborators*)
    id=1345402; login=NikolayS
    [[ "\${FAKE_MODE:-ok}" != admin ]] || { id=280144521; login=samo-agent; }
    jq -nc --argjson id "$id" --arg login "$login" '[[{id:$id,login:$login,permissions:{admin:true}}]]'
    ;;
  *actions/secrets*)
    name=CLOUDFLARE_API_TOKEN; [[ "\${FAKE_MODE:-ok}" != repository ]] || name=SAMO_AGENT_TOKEN
    jq -nc --arg name "$name" '[{secrets:[{name:$name}]}]'
    ;;
  *actions/variables*)
    name=CREDENTIAL_EXPORT_OPEN; value=true
    [[ "\${FAKE_MODE:-ok}" != variable ]] || name=SAMO_AGENT_TOKEN
    [[ "\${FAKE_MODE:-ok}" != variable-value ]] || value=reviewer-token
    jq -nc --arg name "$name" --arg value "$value" '[{variables:[{name:$name,value:$value}]}]'
    ;;
  *dependabot/secrets*)
    if [[ "\${FAKE_MODE:-ok}" == dependabot ]]; then printf '[{"secrets":[{"name":"SAMOREV_TOKEN"}]}]\n'; else printf '[{"secrets":[]}]\n'; fi
    ;;
  *environments?per_page=100) printf '[{"environments":[{"name":"production"},{"name":"credential-migration"}]}]\n' ;;
  *production/secrets*)
    name=CLOUDFLARE_ACCOUNT_ID; [[ "\${FAKE_MODE:-ok}" != production ]] || name=GH_TOKEN
    jq -nc --arg name "$name" '[{secrets:[{name:$name}]}]'
    ;;
  *credential-migration/secrets*)
    if [[ "\${FAKE_MODE:-ok}" == migration ]]; then printf '[{"secrets":[{"name":"SAMOREV_TOKEN"}]}]\n'; else printf '[{"secrets":[]}]\n'; fi
    ;;
  *production/variables*|*credential-migration/variables*)
    if [[ "\${FAKE_MODE:-ok}" == environment-variable ]]; then printf '[{"variables":[{"name":"SAMOREV_TOKEN","value":"x"}]}]\n'; else printf '[{"variables":[]}]\n'; fi
    ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const run = (mode: string): Promise<number> => Bun.spawn([
      "bash", "scripts/check-reviewer-credential-isolation.sh",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: mode },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await run("ok")).toBe(0);
    expect(await run("repository")).toBe(1);
    expect(await run("production")).toBe(1);
    expect(await run("migration")).toBe(1);
    expect(await run("variable")).toBe(1);
    expect(await run("variable-value")).toBe(1);
    expect(await run("dependabot")).toBe(1);
    expect(await run("environment-variable")).toBe(1);
    expect(await run("admin")).toBe(1);
    expect(await Bun.file("scripts/check-branch-protection.sh").text()).not.toContain("check-reviewer-credential-isolation.sh");
  });
});
