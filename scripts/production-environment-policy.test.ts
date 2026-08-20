import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("permanent production environment policy", () => {
  test("executes the required policy API readability gate fail closed", async () => {
    const ciSource = await Bun.file(".github/workflows/ci.yml").text();
    const ci = Bun.YAML.parse(ciSource) as {
      jobs: Record<string, {
        "timeout-minutes"?: number;
        permissions?: Record<string, string>;
        steps: Array<{ name?: string; run?: string }>;
      }>;
    };
    const jobName = "policy-api-readability";
    const job = ci.jobs[jobName];
    expect(job).toBeDefined();
    expect(job["timeout-minutes"]).toBe(2);
    expect(job.permissions).toEqual({ actions: "read", contents: "read" });
    expect(ci.jobs.typecheck?.["timeout-minutes"]).toBe(30);
    const imageRuntime = ci.jobs.typecheck?.steps.find(({ name }) => name === "Install image validation runtime")?.run ?? "";
    expect(imageRuntime).toBe("bash scripts/install-image-validation-runtime.sh");
    const aptHarnessRoot = await mkdtemp(join(tmpdir(), "gitzette-apt-runtime-"));
    const aptBin = join(aptHarnessRoot, "bin");
    await mkdir(aptBin);
    await Bun.write(join(aptBin, "sudo"), `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  sed) [[ "\${FAKE_SUDO_MODE:-normal}" != no-op-sed ]] || exit 0 ;;
  cp) [[ "\${FAKE_SUDO_MODE:-normal}" != copy-error ]] || exit 23 ;;
  apt-get|install) printf '%s\\n' "$*" >>"$FAKE_SUDO_RECORD"; exit 0 ;;
esac
exec "$@"
`);
    await Bun.write(join(aptBin, "grep"), `#!/usr/bin/env bash
set -euo pipefail
[[ "\${FAKE_SUDO_MODE:-normal}" != grep-error ]] || exit 2
exec /usr/bin/grep "$@"
`);
    await Bun.spawn(["chmod", "+x", join(aptBin, "sudo"), join(aptBin, "grep")]).exited;
    const executeImageRuntime = async (
      fixture: string,
      options: { mode?: string; skipInstall?: boolean } = {},
    ): Promise<{ status: number; source: string; record: string }> => {
      const aptRoot = join(aptHarnessRoot, fixture);
      await mkdir(aptRoot);
      const source = join(aptRoot, "sources.list");
      const record = join(aptRoot, "sudo-record");
      await Bun.write(source, "deb https://azure.archive.ubuntu.com/ubuntu noble main\n");
      await Bun.write(record, "");
      const env = {
        ...process.env,
        PATH: `${aptBin}:${process.env.PATH}`,
        APT_ROOT: aptRoot,
        FAKE_SUDO_MODE: options.mode ?? "normal",
        FAKE_SUDO_RECORD: record,
        ...(options.skipInstall ? { APT_SKIP_INSTALL: "true" } : {}),
      };
      const status = await Bun.spawn(["bash", "scripts/install-image-validation-runtime.sh"], {
        cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe",
      }).exited;
      return { status, source: await Bun.file(source).text(), record: await Bun.file(record).text() };
    };
    const aptSuccess = await executeImageRuntime("success");
    expect(aptSuccess.status).toBe(0);
    expect(aptSuccess.source).toContain("https://archive.ubuntu.com/ubuntu");
    expect(aptSuccess.source).not.toContain("azure.archive.ubuntu.com");
    expect(aptSuccess.record).toContain("apt-get update");
    expect(aptSuccess.record).toContain("apt-get install -y");
    expect(aptSuccess.record).toContain("install -o root -g root -m 0644");
    expect((await executeImageRuntime("no-op", { mode: "no-op-sed", skipInstall: true })).status).toBe(1);
    expect((await executeImageRuntime("grep-error", { mode: "grep-error", skipInstall: true })).status).toBe(2);
    expect((await executeImageRuntime("copy-error", { mode: "copy-error", skipInstall: true })).status).toBe(23);
    const githubRootHook = Bun.spawn(["bash", "scripts/install-image-validation-runtime.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, GITHUB_ACTIONS: "true", APT_ROOT: join(aptHarnessRoot, "forbidden-root") },
      stdout: "pipe", stderr: "pipe",
    });
    expect(await githubRootHook.exited).toBe(1);
    expect(await new Response(githubRootHook.stderr).text()).toContain("test hooks are forbidden");
    const githubSkipHook = Bun.spawn(["bash", "scripts/install-image-validation-runtime.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, GITHUB_ACTIONS: "true", APT_SKIP_INSTALL: "true" },
      stdout: "pipe", stderr: "pipe",
    });
    expect(await githubSkipHook.exited).toBe(1);
    expect(await new Response(githubSkipHook.stderr).text()).toContain("test hooks are forbidden");
    const runBlock = job.steps.find(({ name }) => name === "Prove policy guard API readability")?.run;
    expect(runBlock).toBeDefined();
    const protection = JSON.parse(await Bun.file("config/main-branch-protection.json").text()) as {
      required_status_checks: { checks: Array<{ context: string }> };
    };
    expect(protection.required_status_checks.checks.filter(({ context }) => context === jobName)).toHaveLength(1);
    expect(ciSource).toContain("bash scripts/check-branch-protection-policy-file.sh config/main-branch-protection.json");
    const branchPolicyValidator = await Bun.file("scripts/check-branch-protection-policy-file.sh").text();
    expect(branchPolicyValidator).toContain('.repository_rulesets[0].target == "branch"');
    expect(branchPolicyValidator).toContain('.repository_rulesets[0].conditions.ref_name == {"exclude":[],"include":["refs/heads/main"]}');

    const root = await mkdtemp(join(tmpdir(), "gitzette-policy-api-readability-"));
    const gh = join(root, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
endpoint=""
for argument in "$@"; do
  [[ "$argument" != repos/* ]] || endpoint="$argument"
done
case "$endpoint" in
  repos/NikolayS/gitzette/environments/production)
    [[ "\${FAKE_MODE:-ok}" != production-error ]] || { echo forbidden >&2; exit 1; }
    custom=true
    [[ "\${FAKE_MODE:-ok}" != production-custom-false ]] || custom=false
    if [[ "\${FAKE_MODE:-ok}" == production-field-missing ]]; then
      jq -nc --argjson custom "$custom" '{deployment_branch_policy:{custom_branch_policies:$custom}}'
    else
      jq -nc --argjson custom "$custom" '{can_admins_bypass:false,deployment_branch_policy:{custom_branch_policies:$custom}}'
    fi
    ;;
  repos/NikolayS/gitzette/environments/production/deployment-branch-policies*)
    [[ "\${FAKE_MODE:-ok}" != production-policies-error ]] || { echo forbidden >&2; exit 1; }
    printf '{"branch_policies":[]}\n'
    ;;
  repos/NikolayS/gitzette/environments?per_page=100)
    [[ "\${FAKE_MODE:-ok}" != inventory-error ]] || { echo forbidden >&2; exit 1; }
    if [[ "\${FAKE_MODE:-ok}" == ok-no-migration ]]; then
      printf '[{"environments":[]}]\n'
    else
      printf '[{"environments":[{"name":"credential-migration"}]}]\n'
    fi
    ;;
  repos/NikolayS/gitzette/environments/credential-migration)
    [[ "\${FAKE_MODE:-ok}" != migration-error ]] || { echo forbidden >&2; exit 1; }
    custom=false
    [[ "\${FAKE_MODE:-ok}" != ok-custom-true && "\${FAKE_MODE:-ok}" != migration-policies-error ]] || custom=true
    if [[ "\${FAKE_MODE:-ok}" == migration-field-missing ]]; then
      jq -nc --argjson custom "$custom" '{deployment_branch_policy:{custom_branch_policies:$custom}}'
    else
      jq -nc --argjson custom "$custom" '{can_admins_bypass:false,deployment_branch_policy:{custom_branch_policies:$custom}}'
    fi
    ;;
  repos/NikolayS/gitzette/environments/credential-migration/deployment-branch-policies*)
    [[ "\${FAKE_MODE:-ok}" != migration-policies-error ]] || { echo forbidden >&2; exit 1; }
    printf '{"branch_policies":[]}\n'
    ;;
  *) echo "unexpected endpoint: $endpoint" >&2; exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const execute = (mode: string, repository = "NikolayS/gitzette", isForkPr = "false"): Promise<number> => Bun.spawn(["bash", "-c", runBlock ?? "exit 99"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_REPOSITORY: repository, IS_FORK_PR: isForkPr, FAKE_MODE: mode },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await execute("production-error", "fork/gitzette")).toBe(0);
    expect(await execute("production-error", "NikolayS/gitzette", "true")).toBe(0);
    expect(await execute("ok-no-migration")).toBe(0);
    expect(await execute("production-custom-false")).toBe(0);
    expect(await execute("ok-custom-false")).toBe(0);
    expect(await execute("ok-custom-true")).toBe(0);
    for (const mode of [
      "production-error", "production-field-missing", "production-policies-error",
      "inventory-error", "migration-error", "migration-field-missing", "migration-policies-error",
    ]) expect(await execute(mode)).not.toBe(0);
  });

  test("keeps one fixed production ref policy and fails drift loud", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-production-policy-mode-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const gh = join(bin, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
endpoint="\${*: -1}"
case "$endpoint" in
  repos/example/gitzette/environments/production)
    case "\${FAKE_API_ERROR:-none}" in
      auth) echo "fake production API failure" >&2; exit 1 ;;
      missing)
        [[ "$*" != *--include* ]] || printf 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}\n'
        echo "gh: Not Found (HTTP 404)" >&2; exit 1
        ;;
    esac
    bypass=false; [[ "\${FAKE_API_ERROR:-none}" != bypass ]] || bypass=true
    protected=false; custom=true
    reviewers='[{"type":"User","reviewer":{"id":1345402,"login":"NikolayS"}}]'
    jq -nc --argjson bypass "$bypass" --argjson protected "$protected" --argjson custom "$custom" --argjson reviewers "$reviewers" '{can_admins_bypass:$bypass,protection_rules:[{type:"required_reviewers",prevent_self_review:true,reviewers:$reviewers}],deployment_branch_policy:{protected_branches:$protected,custom_branch_policies:$custom}}'
    ;;
  *environments?per_page=100) printf '%s\n' '[{"environments":[]}]' ;;
  *deployment-branch-policies*)
    if [[ "\${FAKE_LIVE_POLICY:-default}" == api-error ]]; then
      echo "fake branch policy API failure" >&2
      exit 1
    elif [[ "\${FAKE_LIVE_POLICY:-default}" == empty ]]; then
      printf '%s\\n' '[{"branch_policies":[]}]'
    elif [[ "\${FAKE_LIVE_POLICY:-default}" == v-only ]]; then
      printf '%s\\n' '[{"branch_policies":[{"name":"v*","type":"tag"}]}]'
    else
      printf '%s\\n' '[{"branch_policies":[{"name":"main","type":"branch"},{"name":"v*","type":"tag"}]}]'
    fi
    ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const date = join(bin, "date");
    await Bun.write(date, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *" -d "* ]]; then printf '100\\n'; else printf '%s\\n' "\${FAKE_NOW_EPOCH:-99}"; fi
`);
    await Bun.spawn(["chmod", "+x", date]).exited;
    const run = async (live: string, apiError = "none", nowEpoch = "99"): Promise<{ code: number; stdout: string; stderr: string }> => {
      const child = Bun.spawn(["bash", "scripts/check-production-environment.sh"], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_LIVE_POLICY: live, FAKE_API_ERROR: apiError, FAKE_NOW_EPOCH: nowEpoch },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    };
    const normal = await run("default");
    expect(normal.code).toBe(0);
    expect(normal.stdout).toContain("admitted refs: main, v*");
    const expiredWidened = await run("default", "none", "100");
    expect(expiredWidened.code).toBe(1);
    const expiredNarrowed = await run("v-only", "none", "100");
    expect(expiredNarrowed.code).toBe(0);
    expect(expiredNarrowed.stdout).toContain("admitted refs: v*");
    const empty = await run("empty");
    expect(empty.code).toBe(1);
    expect(empty.stderr).toContain('"branch_policies":[]');
    const policyApiFailure = await run("api-error");
    expect(policyApiFailure.code).toBe(3);
    expect(policyApiFailure.stderr).toContain("unable to read production deployment branch policies");
    const apiFailure = await run("default", "auth");
    expect(apiFailure.code).toBe(3);
    expect(apiFailure.stderr).toContain("unable to read production environment");
    expect(apiFailure.stderr).toContain("fake production API failure");
    const missing = await run("default", "missing");
    expect(missing.code).toBe(4);
    expect(missing.stderr).toContain("production environment is missing; run scripts/apply-production-environment.sh");
    expect(missing.stderr).toContain("absent from the readable repository inventory");
    const bypass = await run("default", "bypass");
    expect(bypass.code).toBe(1);
    expect(bypass.stderr).toContain('disable "Allow administrators to bypass configured protection rules"');
    expect(bypass.stderr).toContain("environment production");
  });

  test("applies the fixed main and release-tag policy idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-production-policy-apply-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const state = join(root, "policies.json");
    await Bun.write(state, '[{"id":10,"name":"v*","type":"tag"},{"id":11,"name":"v*","type":"tag"}]');
    const gh = join(bin, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
method=GET; endpoint=""; name=""; type=""
for argument in "$@"; do
  [[ "$argument" != PUT && "$argument" != POST && "$argument" != DELETE ]] || method="$argument"
  [[ "$argument" != repos/* ]] || endpoint="$argument"
  [[ "$argument" != name=* ]] || name="\${argument#name=}"
  [[ "$argument" != type=* ]] || type="\${argument#type=}"
done
case "$method:$endpoint" in
  PUT:repos/example/gitzette/environments/production) printf x >>"$FAKE_STATE.put-count"; cat >"$FAKE_STATE.put" ;;
  GET:repos/example/gitzette/environments/production)
    if [[ "\${FAKE_CREATE:-false}" == true && ! -f "$FAKE_STATE.put" ]]; then
      if [[ "$*" == *--include* ]]; then printf 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}\n'; fi
      exit 1
    fi
    bypass=false; [[ "\${FAKE_ADMIN_BYPASS:-false}" != true ]] || bypass=true
    [[ "\${FAKE_CREATE:-false}" != true ]] || bypass=true
    policy='{"protected_branches":false,"custom_branch_policies":true}'
    reviewers='[{"type":"User","reviewer":{"id":1345402,"login":"NikolayS"}}]'
    [[ ! -f "$FAKE_STATE.put" ]] || policy="$(jq -c .deployment_branch_policy "$FAKE_STATE.put")"
    if [[ -f "$FAKE_STATE.put" ]]; then
      reviewers="$(jq -c '[.reviewers[] | {type,reviewer:{id,login:(if .id == 1345402 then "NikolayS" else "samo-agent" end)}}]' "$FAKE_STATE.put")"
    fi
    jq -nc --argjson bypass "$bypass" --argjson policy "$policy" --argjson reviewers "$reviewers" '{can_admins_bypass:$bypass,protection_rules:[{type:"required_reviewers",prevent_self_review:true,reviewers:$reviewers}],deployment_branch_policy:$policy}'
    ;;
  GET:*environments?per_page=100) printf '[{"environments":[]}]\n' ;;
  GET:*deployment-branch-policies*) jq -c '[{branch_policies:.}]' "$FAKE_STATE" ;;
  POST:*deployment-branch-policies*)
    printf '%s:%s\n' "$name" "$type" >>"$FAKE_STATE.post-log"
    next_id="$(jq '[.[].id] | max + 1' "$FAKE_STATE")"
    jq --argjson id "$next_id" --arg name "$name" --arg type "$type" '. + [{id:$id,name:$name,type:$type}]' "$FAKE_STATE" >"$FAKE_STATE.next"
    mv "$FAKE_STATE.next" "$FAKE_STATE"
    ;;
  DELETE:*deployment-branch-policies/*)
    id="\${endpoint##*/}"
    jq --argjson id "$id" 'map(select(.id != $id))' "$FAKE_STATE" >"$FAKE_STATE.next"
    mv "$FAKE_STATE.next" "$FAKE_STATE"
    ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const date = join(bin, "date");
    await Bun.write(date, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *" -d "* ]]; then printf '100\\n'; else printf '%s\\n' "\${FAKE_NOW_EPOCH:-99}"; fi
`);
    await Bun.spawn(["chmod", "+x", date]).exited;
    const run = async (adminBypass = false, create = false, nowEpoch = "99", restoreBaseline = false): Promise<number> => Bun.spawn([
      "bash", "scripts/apply-production-environment.sh", ...(restoreBaseline ? ["--restore-baseline"] : []),
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_STATE: state, FAKE_ADMIN_BYPASS: String(adminBypass), FAKE_CREATE: String(create), FAKE_NOW_EPOCH: nowEpoch },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await run()).toBe(0);
    expect(JSON.parse(await Bun.file(`${state}.put`).text()).can_admins_bypass).toBeUndefined();
    expect(JSON.parse(await Bun.file(state).text()).map(({ name }: { name: string }) => name).sort()).toEqual(["main", "v*"]);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("x");
    expect(await run(true)).toBe(1);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("x");
    await rm(`${state}.put`, { force: true });
    await rm(`${state}.put-count`, { force: true });
    expect(await run(false, true)).toBe(1);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("x");
    expect(await run(false, false, "100")).toBe(1);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("x");
    await rm(`${state}.post-log`, { force: true });
    expect(await run(false, false, "100", true)).toBe(0);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("xx");
    expect(JSON.parse(await Bun.file(state).text()).map(({ name }: { name: string }) => name)).toEqual(["v*"]);
    expect(await Bun.file(`${state}.post-log`).exists()).toBe(false);
    expect(await run(false, false, "100", true)).toBe(0);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("xxx");
    expect(JSON.parse(await Bun.file(state).text()).map(({ name }: { name: string }) => name)).toEqual(["v*"]);
    expect(await Bun.file(`${state}.post-log`).exists()).toBe(false);

    const applySource = await Bun.file("scripts/apply-production-environment.sh").text();
    expect(applySource).toContain("temporary production main admission expired");
    expect(applySource).toContain('any(.branch_policies[]?; .name == "main" and .type == "branch")');
    expect(applySource).toContain("--restore-baseline");
    const policyBlock = applySource.slice(
      applySource.indexOf('expected_policies='),
      applySource.lastIndexOf('\nif [[ "$restore_baseline" == true ]]'),
    );
    const protectedPolicy = join(root, "protected-policy.json");
    await Bun.write(protectedPolicy, JSON.stringify({
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      branch_policies: [],
    }));
    const rejectingGh = join(bin, "rejecting-gh");
    await Bun.write(rejectingGh, "#!/usr/bin/env bash\necho unexpected-policy-API-call >&2\nexit 77\n");
    await Bun.spawn(["chmod", "+x", rejectingGh]).exited;
    const protectedBlock = Bun.spawn([
      "bash", "-c", `set -euo pipefail
policy="$FAKE_POLICY"
effective_policy="$(jq -c . "$policy")"
repository=example/gitzette
gh() { "$FAKE_GH" "$@"; }
${policyBlock}`,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, FAKE_POLICY: protectedPolicy, FAKE_GH: rejectingGh },
      stdout: "pipe", stderr: "pipe",
    });
    expect(await protectedBlock.exited).toBe(0);
  });

  test("distinguishes inventory-proven absence from permission-masked 404", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-environment-lookup-"));
    const gh = join(root, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
endpoint="\${*: -1}"
case "$endpoint" in
  repos/example/gitzette/environments/production)
    if [[ "\${FAKE_MODE:-ok}" == ok ]]; then printf '{"name":"production"}\n'; exit 0; fi
    if [[ "\${FAKE_MODE:-ok}" == transient && "$*" != *--include* && -f "$FAKE_STATE.transient" ]]; then
      printf '{"name":"production"}\n'; exit 0
    fi
    if [[ "$*" == *--include* ]]; then
      if [[ "\${FAKE_MODE:-ok}" == transient ]]; then
        : >"$FAKE_STATE.transient"
        printf 'HTTP/1.1 301 Redirect\r\n\r\nHTTP/2.0 200 OK\r\n\r\n{"name":"production"}\n'
        exit 0
      fi
      status=404; [[ "\${FAKE_MODE:-ok}" != server-error ]] || status=500
      printf 'HTTP/2.0 %s Error\r\n\r\n{"message":"error"}\n' "$status"
    fi
    echo 'lookup failed' >&2
    exit 1
    ;;
  *environments?per_page=100)
    if [[ "\${FAKE_MODE:-ok}" == absent ]]; then
      printf '[{"environments":[]}]\n'
    else
      printf '[{"environments":[{"name":"production"}]}]\n'
    fi
    ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const run = (mode: string): Promise<number> => Bun.spawn([
      "bash", "scripts/get-github-environment.sh", "example/gitzette", "production",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, FAKE_MODE: mode, FAKE_STATE: join(root, "state") },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await run("ok")).toBe(0);
    expect(await run("absent")).toBe(4);
    expect(await run("masked")).toBe(3);
    expect(await run("server-error")).toBe(3);
    expect(await run("transient")).toBe(0);
  });
});
