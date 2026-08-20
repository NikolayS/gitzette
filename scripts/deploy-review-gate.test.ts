import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("deploy review revalidation", () => {
  test("binds release to exact workflow paths and the immutable reviewer", async () => {
    const workflow = await Bun.file(".github/workflows/deploy.yml").text();
    const parsedWorkflow = Bun.YAML.parse(workflow) as {
      jobs: Record<string, { "timeout-minutes"?: number }>;
    };
    const gate = await Bun.file("scripts/check-release-review-evidence.sh").text();
    const codeowners = await Bun.file(".github/CODEOWNERS").text();
    const documentation = await Bun.file("docs/review-gate.md").text();
    const branchPolicy = JSON.parse(await Bun.file("config/main-branch-protection.json").text());
    const applyBranchPolicy = await Bun.file("scripts/apply-branch-protection.sh").text();
    const checkBranchPolicy = await Bun.file("scripts/check-branch-protection.sh").text();
    const mergeReviewedHead = await Bun.file("scripts/merge-reviewed-head.sh").text();
    const validateBranchPolicy = await Bun.file("scripts/check-branch-protection-policy-file.sh").text();
    const checkNonadminBoundary = await Bun.file("scripts/check-branch-protection-nonadmin.sh").text();
    const reviewerWrapper = await Bun.file("scripts/run-samorev-review.sh").text();
    const tagActorGate = "scripts/check-release-tag-actor.sh";
    expect(workflow).toContain('set -euo pipefail');
    expect(parsedWorkflow.jobs["review-gate"]?.["timeout-minutes"]).toBe(5);
    expect(parsedWorkflow.jobs.deploy?.["timeout-minutes"]).toBe(20);
    expect(workflow).toContain('bash scripts/check-release-review-evidence.sh "$reviewed_sha"');
    expect(workflow).toContain("TAG_PUSHER_ID: ${{ github.actor_id }}");
    expect(workflow).toContain('triggering_actor_id="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" --jq .triggering_actor.id)"');
    expect(workflow).not.toContain("TRIGGERING_ACTOR_LOGIN");
    expect(workflow).toContain('bash scripts/check-release-tag-actor.sh "$TAG_PUSHER_ID" "$triggering_actor_id"');
    expect(workflow).not.toContain('/reviews\")');
    expect(workflow).not.toContain('.state == "APPROVED"');
    expect(gate).toContain('actions/workflows/ci.yml/runs?event=pull_request&head_sha=$reviewed_sha');
    expect(gate).toContain('actions/workflows/samorev-gate.yml/runs?event=pull_request_target&head_sha=$reviewed_sha');
    expect(gate).toContain('.path == ".github/workflows/ci.yml"');
    expect(gate).toContain('.path == ".github/workflows/samorev-gate.yml"');
    expect(gate).toContain('.base.ref == "main"');
    expect(gate).toContain('.head_repository.full_name == $repository');
    expect(gate).toContain('.html_url == $url');
    expect(gate).toContain('publisher_url="$(jq -er .target_url');
    expect(gate).toContain("sort_by(.created_at, .id) | last");
    expect(gate).toContain('.creator.id == 280144521');
    expect(gate).toContain("gh api --paginate --slurp");
    expect(gate.match(/gh api --paginate --slurp/g)).toHaveLength(3);
    expect(gate).not.toContain('.creator.login == "samo-agent"');
    expect(codeowners.trim()).toBe("* @samo-agent");
    expect(branchPolicy.repository_rulesets).toEqual([
      {
        name: "main-samo-only-updates", target: "branch", enforcement: "active",
        bypass_actors: [{ actor_id: 280144521, actor_type: "User", bypass_mode: "always" }],
        conditions: { ref_name: { exclude: [], include: ["refs/heads/main"] } },
        rules: [
          { type: "creation" },
          { type: "update", parameters: { update_allows_fetch_and_merge: false } },
          { type: "deletion" },
        ],
      },
      {
        name: "release-tags-samo-only", target: "tag", enforcement: "active",
        bypass_actors: [{ actor_id: 280144521, actor_type: "User", bypass_mode: "always" }],
        conditions: { ref_name: { exclude: [], include: ["refs/tags/v*"] } },
        rules: [
          { type: "creation" },
          { type: "update", parameters: { update_allows_fetch_and_merge: false } },
          { type: "deletion" },
        ],
      },
    ]);
    expect(branchPolicy.allow_auto_merge).toBe(false);
    expect(applyBranchPolicy).toContain("{allow_auto_merge}");
    expect(documentation).toContain("auto-merge is disabled and audited");
    expect(documentation).toContain("scripts/run-samorev-review.sh");
    expect(reviewerWrapper).toContain("SAMOREV_IGNORED_GITHUB_CHECK_RUN_IDS");
    expect(reviewerWrapper).toContain("SAMOREV_IGNORED_GITHUB_CHECK_NAME");
    expect(reviewerWrapper).toContain("SAMOREV_IGNORED_GITHUB_CHECK_APP_ID=15368");
    expect(reviewerWrapper).toContain('.path == ".github/workflows/samorev-gate.yml"');
    expect(reviewerWrapper).toContain('.event == "pull_request_target"');
    expect(reviewerWrapper).toContain('.head_repository.full_name == $repository');
    expect(reviewerWrapper).toContain('-f target_url="$publisher_url"');
    expect(reviewerWrapper).toContain("publish error");
    expect(reviewerWrapper).toContain('>"$log_file" 2>&1');
    expect(reviewerWrapper).not.toContain('> >(tee "$log_file")');
    expect(applyBranchPolicy.indexOf("check-branch-protection-policy-file.sh")).toBeLessThan(
      applyBranchPolicy.indexOf("{allow_auto_merge}"),
    );
    expect(validateBranchPolicy).toContain("repository_rulesets | length");
    expect(applyBranchPolicy).not.toContain("BRANCH_PROTECTION_POLICY");
    expect(applyBranchPolicy.indexOf("trap audit_partial_apply EXIT")).toBeLessThan(
      applyBranchPolicy.indexOf("{allow_auto_merge}"),
    );
    expect(applyBranchPolicy.indexOf("repository_rulesets[]")).toBeLessThan(
      applyBranchPolicy.indexOf("actions/permissions/workflow"),
    );
    expect(applyBranchPolicy).toContain("current_user_can_bypass");
    expect(applyBranchPolicy).not.toContain("auth token --user samo-agent");
    expect(applyBranchPolicy).not.toContain("check-branch-protection-nonadmin.sh");
    expect(documentation).toContain("administrator-only and deliberately does not load the `samo-agent`");
    expect(documentation).toContain("separate shell/session containing only");
    expect(checkBranchPolicy.indexOf("check-branch-protection-policy-file.sh")).toBeLessThan(
      checkBranchPolicy.indexOf("expected=\"$(jq"),
    );
    expect(mergeReviewedHead).toContain('check-release-review-evidence.sh" "$head_sha"');
    expect(mergeReviewedHead).toContain('check-branch-protection.sh"');
    expect(mergeReviewedHead).toContain('--match-head-commit "$head_sha"');
    expect(mergeReviewedHead.indexOf("check-release-review-evidence.sh")).toBeLessThan(
      mergeReviewedHead.indexOf("gh pr merge"),
    );
    expect(checkNonadminBoundary.indexOf("select(length == 2 and")).toBeLessThan(
      checkNonadminBoundary.indexOf("while IFS= read -r ruleset_name"),
    );
    for (const reviewedPath of [
      "`.github/workflows/**`",
      "`scripts/*.sh`",
      "`scripts/normalize-branch-protection.jq`",
      "`config/main-branch-protection.json`",
      "`config/*-environment.json`",
    ]) {
      expect(documentation).toContain(reviewedPath);
    }
    expect(documentation).toContain("Actions bot's immutable ID, not `280144521`");
    expect(documentation).toContain("GitHub Actions and repository administrators are\nnot bypass actors");
    expect(documentation).toContain("Administrator policy authorization is explicit");
    expect(documentation).toContain("intentionally removed formal GitHub\npull-request approval as evidence");
    expect(documentation).toContain("Nik explicitly accepts one bootstrap residual risk");
    expect(documentation).toContain("single-person availability dependency");
    expect(documentation).toContain("incident/change record naming a specific substitute reviewer");
    expect(documentation).toContain("Never edit the live reviewer set without first");
    expect(documentation).toContain(
      "For canonical same-repository PRs, required `policy-api-readability`",
    );
    expect(documentation).toContain(
      "Fork and non-canonical PRs satisfy this context\nvacuously",
    );
    expect(documentation).toContain("Like every PR CI context it is head-controlled");
    expect(documentation).toContain("one merge-button or direct-CLI action by the\n`samo-agent` credential");
    expect(documentation).toContain("Formal GitHub approval is not restored");
    expect(documentation).toContain("does not automatically narrow the live\n`production` deployment policy");
    expect(documentation).toContain("scripts/apply-production-environment.sh --restore-baseline");
    expect(documentation).toContain(
      "`scripts/merge-reviewed-head.sh` rejects them",
    );
    expect(documentation).toContain("`scripts/apply-production-environment.sh`");
    expect(documentation).toContain("not an approved break-glass path");
    expect(documentation).toContain("`scripts/check-branch-protection.sh`");
    const agentNotes = await Bun.file("CLAUDE.md").text();
    expect(agentNotes).not.toContain("admin-only update ruleset");
    expect(agentNotes).toContain("Only the external\n`samo-agent` identity (ID `280144521`) may update `main`");
    expect(documentation).toContain("release-tags-samo-only");
    expect(documentation).toContain('tag_sha="$(gh api');
    expect(documentation).toContain('[[ "$tag_sha" == "$main_sha" ]]');
    const runTagActorGate = (actor?: string, triggeringActor?: string): Promise<number> => Bun.spawn([
      "bash", tagActorGate, ...([actor, triggeringActor].filter((value) => value !== undefined) as string[]),
    ], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" }).exited;
    expect(await runTagActorGate("280144521", "280144521")).toBe(0);
    expect(await runTagActorGate("280144521", "1345402")).toBe(1);
    expect(await runTagActorGate("1345402", "280144521")).toBe(1);
    expect(await runTagActorGate("41898282", "280144521")).toBe(1);
    expect(await runTagActorGate("", "280144521")).toBe(1);
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

  test("executes the reviewed-current-main workflow block", async () => {
    const workflow = Bun.YAML.parse(await Bun.file(".github/workflows/deploy.yml").text()) as {
      jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
    };
    const raw = workflow.jobs["review-gate"].steps.find(({ name }) =>
      name === "Require the reviewed current main merge")?.run;
    expect(raw).toBeDefined();
    const runBlock = (raw ?? "exit 99").replace(
      'bash scripts/check-release-review-evidence.sh "$reviewed_sha"',
      ': "$reviewed_sha"',
    );
    const root = await mkdtemp(join(tmpdir(), "gitzette-deploy-main-gate-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    await Bun.write(join(bin, "git"), `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" != fetch ]] || exit 0
[[ "$1" != rev-parse ]] || { printf '%s\\n' "$FAKE_MAIN_SHA"; exit 0; }
exit 91
`);
await Bun.write(join(bin, "gh"), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"/actions/runs/"* ]]; then
  printf '%s\\n' "\${FAKE_TRIGGERING_ACTOR_ID:-280144521}"
  exit 0
fi
base=main; merged=2026-01-01T00:00:00Z; merge_sha="$GITHUB_SHA"
case "\${FAKE_MODE:-success}" in
  none) printf '[]\\n'; exit 0 ;;
  unmerged) merged=null ;;
  wrong-base) base=attacker ;;
esac
jq -nc --arg base "$base" --arg merged "$merged" --arg merge_sha "$merge_sha" \
  '[{base:{ref:$base},merged_at:(if $merged == "null" then null else $merged end),merge_commit_sha:$merge_sha,head:{sha:("b" * 40)}}]'
`);
    await Bun.spawn(["chmod", "+x", join(bin, "git"), join(bin, "gh")]).exited;
    const sha = "a".repeat(40);
    const execute = (mode: string, mainSha = sha, tagPusherId = "280144521"): Promise<number> => Bun.spawn([
      "bash", "-c", runBlock,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_SHA: sha,
        FAKE_MAIN_SHA: mainSha, FAKE_MODE: mode, GITHUB_REPOSITORY: "example/gitzette",
        GITHUB_RUN_ID: "77", TAG_PUSHER_ID: tagPusherId,
      },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await execute("success")).toBe(0);
    expect(await execute("success", sha, "1345402")).not.toBe(0);
    expect(await Bun.spawn(["bash", "-c", runBlock], {
      cwd: process.cwd(),
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_SHA: sha,
        FAKE_MAIN_SHA: sha, FAKE_MODE: "success", GITHUB_REPOSITORY: "example/gitzette",
        GITHUB_RUN_ID: "77", TAG_PUSHER_ID: "280144521", FAKE_TRIGGERING_ACTOR_ID: "1",
      },
      stdout: "pipe", stderr: "pipe",
    }).exited).not.toBe(0);
    expect(await execute("success", "c".repeat(40))).not.toBe(0);
    expect(await execute("none")).not.toBe(0);
    expect(await execute("unmerged")).not.toBe(0);
    expect(await execute("wrong-base")).not.toBe(0);
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
      jq -nc --arg sha "$FAKE_SHA" '[{workflow_runs:[{id:2,path:".github/workflows/attacker.yml",event:"pull_request",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",conclusion:"success"}]}]'
    else
      latest=success; [[ "$mode" != latest-ci-failure ]] || latest=failure
      base=main; [[ "$mode" != wrong-ci-base ]] || base=attacker
      repository=example/gitzette; [[ "$mode" != fork-ci-head ]] || repository=attacker/gitzette
      jq -nc --arg sha "$FAKE_SHA" --arg latest "$latest" --arg base "$base" --arg repository "$repository" '[{workflow_runs:[
        {id:1,path:".github/workflows/ci.yml",event:"pull_request",head_sha:$sha,created_at:"2026-01-01T00:00:00Z",conclusion:"success",head_repository:{full_name:"example/gitzette"},pull_requests:[{base:{ref:"main",repo:{url:"https://api.github.com/repos/example/gitzette"}},head:{sha:$sha,repo:{url:"https://api.github.com/repos/example/gitzette"}}}]},
        {id:2,path:".github/workflows/ci.yml",event:"pull_request",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",conclusion:$latest,head_repository:{full_name:$repository},pull_requests:[{base:{ref:$base,repo:{url:"https://api.github.com/repos/example/gitzette"}},head:{sha:$sha,repo:{url:("https://api.github.com/repos/" + $repository)}}}]}]}]'
    fi
    ;;
  *actions/workflows/samorev-gate.yml/runs*)
    if [[ "$mode" == no-gate-path ]]; then
      jq -nc --arg sha "$FAKE_SHA" '[{workflow_runs:[{id:2,path:".github/workflows/attacker.yml",event:"pull_request_target",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",conclusion:"success"}]}]'
    else
      latest=success
      [[ "$mode" != latest-gate-failure && "$mode" != later-gate-failure ]] || latest=failure
      base=main; [[ "$mode" != wrong-base ]] || base=attacker
      repository=example/gitzette; [[ "$mode" != fork-head ]] || repository=attacker/gitzette
      jq -nc --arg sha "$FAKE_SHA" --arg latest "$latest" --arg base "$base" --arg repository "$repository" '[{workflow_runs:[
        {id:1,path:".github/workflows/samorev-gate.yml",event:"pull_request_target",head_sha:$sha,created_at:"2026-01-01T00:00:00Z",run_started_at:"2026-01-01T00:00:00Z",html_url:"https://github.com/example/gitzette/actions/runs/1",conclusion:"success",head_repository:{full_name:"example/gitzette"},pull_requests:[{base:{ref:"main",repo:{url:"https://api.github.com/repos/example/gitzette"}},head:{sha:$sha,repo:{url:"https://api.github.com/repos/example/gitzette"}}}]},
        {id:2,path:".github/workflows/samorev-gate.yml",event:"pull_request_target",head_sha:$sha,created_at:"2026-01-02T00:00:00Z",run_started_at:"2026-01-02T00:00:00Z",html_url:"https://github.com/example/gitzette/actions/runs/2",conclusion:$latest,head_repository:{full_name:$repository},pull_requests:[{base:{ref:$base,repo:{url:"https://api.github.com/repos/example/gitzette"}},head:{sha:$sha,repo:{url:("https://api.github.com/repos/" + $repository)}}}]}]}]'
    fi
    ;;
  *statuses*)
    latest_state=success; latest_id=280144521; latest_login=samo-agent
    if [[ "$mode" == latest-review-failure ]]; then latest_state=failure; fi
    if [[ "$mode" == forged-reviewer ]]; then latest_id=1; latest_login=attacker; fi
    if [[ "$mode" == renamed-reviewer ]]; then latest_login=renamed-samo; fi
    target=https://github.com/example/gitzette/actions/runs/2
    [[ "$mode" != wrong-publisher-target ]] || target=https://github.com/example/gitzette/actions/runs/999
    [[ "$mode" != later-gate-failure ]] || target=https://github.com/example/gitzette/actions/runs/1
    missing_target=false; [[ "$mode" != missing-publisher-target ]] || missing_target=true
    created_at=2026-01-03T00:00:00Z; [[ "$mode" != predated-verdict ]] || created_at=2026-01-01T00:00:00Z
    jq -nc --arg state "$latest_state" --argjson actor "$latest_id" --arg login "$latest_login" --arg target "$target" --arg created_at "$created_at" --argjson missing_target "$missing_target" '[[
      {id:1,context:"samorev",state:"success",created_at:"2026-01-01T00:00:00Z",target_url:"https://github.com/example/gitzette/actions/runs/1",creator:{id:280144521,login:"samo-agent"}},
      {id:2,context:"samorev",state:$state,created_at:$created_at,target_url:$target,creator:{id:$actor,login:$login}}]] |
      if $missing_target then del(.[0][1].target_url) else . end'
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
    expect(await run("later-gate-failure")).toBe(0);
    for (const mode of [
      "latest-ci-failure", "no-ci-path", "latest-gate-failure", "no-gate-path",
      "latest-review-failure", "forged-reviewer", "wrong-ci-base", "fork-ci-head",
      "wrong-base", "fork-head", "wrong-publisher-target", "missing-publisher-target", "predated-verdict", "api-error",
    ]) {
      const code = await run(mode);
      if (code === 0) throw new Error(`${mode} unexpectedly passed release evidence`);
    }
  });

  test("keeps the external reviewer credential out of Actions secret stores", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-reviewer-isolation-"));
    const gh = join(root, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
endpoint="\${*: -1}"
if [[ "\${FAKE_MODE:-ok}" == api-error ]]; then echo 'fake isolation API failure' >&2; exit 1; fi
case "$endpoint" in
  *collaborators*)
    if [[ "\${FAKE_MODE:-ok}" == empty-admin ]]; then printf '[[]]\n'; exit 0; fi
    id=1345402; login=NikolayS
    [[ "\${FAKE_MODE:-ok}" != admin ]] || { id=280144521; login=samo-agent; }
    jq -nc --argjson id "$id" --arg login "$login" '[[{id:$id,login:$login,permissions:{admin:true}}]]'
    ;;
  *actions/secrets*)
    if [[ "\${FAKE_MODE:-ok}" == repository ]]; then
      printf '[{"secrets":[{"name":"CLAUDE_CODE_OAUTH_TOKEN"},{"name":"SAMO_AGENT_TOKEN"}]}]\n'
    elif [[ "\${FAKE_MODE:-ok}" == post-migration ]]; then
      printf '[{"secrets":[{"name":"CLAUDE_CODE_OAUTH_TOKEN"}]}]\n'
    else
      printf '[{"secrets":[{"name":"CLAUDE_CODE_OAUTH_TOKEN"},{"name":"CLOUDFLARE_API_TOKEN"}]}]\n'
    fi
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
  *environments?per_page=100)
    if [[ "\${FAKE_MODE:-ok}" == production-missing ]]; then
      printf '[{"environments":[{"name":"credential-migration"}]}]\n'
    elif [[ "\${FAKE_MODE:-ok}" == invalid-environment-name ]]; then
      printf '[{"environments":[{"name":"production"},{"name":"unsafe name"}]}]\n'
    else
      printf '[{"environments":[{"name":"production"},{"name":"credential-migration"}]}]\n'
    fi
    ;;
  *production/secrets*)
    if [[ "\${FAKE_MODE:-ok}" == production ]]; then
      printf '[{"secrets":[{"name":"GH_TOKEN"}]}]\n'
    elif [[ "\${FAKE_MODE:-ok}" == production-empty ]]; then
      printf '[{"secrets":[]}]\n'
    elif [[ "\${FAKE_MODE:-ok}" == production-incomplete ]]; then
      printf '[{"secrets":[{"name":"PRODUCTION_CLOUDFLARE_ACCOUNT_ID"}]}]\n'
    else
      printf '[{"secrets":[{"name":"PRODUCTION_CLOUDFLARE_API_TOKEN"},{"name":"PRODUCTION_CLOUDFLARE_ACCOUNT_ID"}]}]\n'
    fi
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
    const run = (mode: string, requireProductionCredentials = "false"): Promise<number> => Bun.spawn([
      "bash", "scripts/check-reviewer-credential-isolation.sh",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "example/gitzette",
        FAKE_MODE: mode,
        REQUIRE_PRODUCTION_CREDENTIALS: requireProductionCredentials,
      },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await run("ok")).toBe(0);
    expect(await run("production-empty")).toBe(0);
    expect(await run("production-incomplete")).toBe(1);
    expect(await run("production-missing")).toBe(1);
    expect(await run("ok", "true")).toBe(1);
    expect(await run("post-migration", "true")).toBe(0);
    expect(await run("production-empty", "true")).toBe(1);
    expect(await run("ok", "invalid")).toBe(1);
    expect(await run("repository")).toBe(1);
    expect(await run("production")).toBe(1);
    expect(await run("migration")).toBe(1);
    expect(await run("variable")).toBe(1);
    expect(await run("variable-value")).toBe(1);
    expect(await run("dependabot")).toBe(1);
    expect(await run("environment-variable")).toBe(1);
    expect(await run("admin")).toBe(1);
    const invalidEnvironment = Bun.spawn(["bash", "scripts/check-reviewer-credential-isolation.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: "invalid-environment-name" },
      stdout: "pipe", stderr: "pipe",
    });
    const invalidEnvironmentStderr = await new Response(invalidEnvironment.stderr).text();
    expect(await invalidEnvironment.exited).toBe(1);
    expect(invalidEnvironmentStderr).toContain("environment name cannot be safely audited: unsafe name");
    expect(invalidEnvironmentStderr).not.toContain("unable to read");
    const apiError = Bun.spawn(["bash", "scripts/check-reviewer-credential-isolation.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: "api-error" },
      stdout: "pipe", stderr: "pipe",
    });
    const apiErrorStderr = await new Response(apiError.stderr).text();
    expect(await apiError.exited).toBe(3);
    expect(apiErrorStderr).toContain("unable to read repository collaborators");
    expect(apiErrorStderr).toContain("fake isolation API failure");
    const emptyAdmin = Bun.spawn(["bash", "scripts/check-reviewer-credential-isolation.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: "empty-admin" },
      stdout: "pipe", stderr: "pipe",
    });
    const emptyAdminError = await new Response(emptyAdmin.stderr).text();
    expect(await emptyAdmin.exited).toBe(1);
    expect(emptyAdminError).toContain("repository administrator set must be exactly NikolayS");
    expect(await Bun.file("scripts/check-branch-protection.sh").text()).not.toContain("check-reviewer-credential-isolation.sh");
  });
});
