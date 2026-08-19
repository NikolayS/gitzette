import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type TestSelector = { quoted: boolean; value: string };
const globMetacharacters = /[*?\[\]{}]/;
const repoRoot = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");

function selectorSelectsFile(selector: TestSelector, absoluteName: string): boolean {
  const repoRelativeName = relative(repoRoot, resolve(absoluteName));
  if (selector.quoted || !globMetacharacters.test(selector.value)) {
    return repoRelativeName.includes(selector.value);
  }
  return new Bun.Glob(selector.value).match(repoRelativeName);
}

describe("TypeScript project coverage", () => {
  test("CI bounds and retries image runtime installation", async () => {
    const workflow = await Bun.file(resolve(repoRoot, ".github/workflows/ci.yml")).text();
    expect(workflow).toContain("for attempt in 1 2");
    expect(workflow.match(/timeout --foreground --kill-after=10s 300s apt-get/g)?.length).toBe(2);
    expect(workflow).toContain("s|http://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g");
    expect(workflow).toContain("-name 'apt-mirrors.txt'");
    expect(workflow).toContain("grep -R -Fq 'azure.archive.ubuntu.com' /etc/apt");
    expect(workflow).toContain("failed to replace the unavailable Azure Ubuntu mirror");
    expect(workflow).toContain('if [[ "$attempt" -eq 2 ]]');
    expect(workflow).toContain("timeout --foreground --kill-after=10s 60s dpkg --configure -a");
    expect(workflow).toContain("ImageMagick installation failed after two bounded attempts");
    expect(workflow).toContain("imagemagick=8:6.9.12.98+dfsg1-5.2build2");
    expect(workflow).toContain("imagemagick-6.q16=8:6.9.12.98+dfsg1-5.2build2");
    expect(workflow).toContain('[[ ! -f .github/workflows/migrate-production-credentials.yml ]] || bootstrap=true');
    expect(workflow).toContain("if $bootstrap then");
  });

  test("the runner project typechecks every runner test file", () => {
    const configPath = resolve(repoRoot, "runner/tsconfig.json");
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(loaded.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve(repoRoot, "runner"));
    const files = new Set(parsed.fileNames.map((name) => resolve(name)));
    const discovered = ts.sys.readDirectory(resolve(repoRoot, "runner"), [".ts"], undefined, ["**/*.test.ts"]);
    expect(discovered.length).toBeGreaterThan(0);
    for (const name of discovered) {
      expect(files.has(resolve(name)), `runner test omitted from typecheck: ${name}`).toBe(true);
    }
  });

  test("the test project typechecks every top-level script", () => {
    const configPath = resolve(repoRoot, "tsconfig.test.json");
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(loaded.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, repoRoot);
    const files = new Set(parsed.fileNames.map((name) => resolve(name)));
    const discovered = ts.sys.readDirectory(resolve(repoRoot, "scripts"), [".ts"], undefined, ["*.ts"], 1);
    expect(discovered.length).toBeGreaterThan(0);
    for (const name of discovered) {
      expect(files.has(resolve(name)), `script omitted from typecheck: ${name}`).toBe(true);
    }
  });

  test("the test command discovers every top-level script test", async () => {
    const packageJson = JSON.parse(await Bun.file(resolve(repoRoot, "package.json")).text()) as {
      scripts?: Record<string, string>;
    };
    const runnerCommand = packageJson.scripts?.["test:runner"];
    expect(runnerCommand).toBeDefined();
    const testCommands = runnerCommand?.split(/\s*(?:&&|\|\||;)\s*/)
      .filter(command => /^bun\s+test(?:\s|$)/.test(command.trim())) ?? [];
    expect(testCommands.length).toBeGreaterThan(0);
    const expandedArguments = testCommands.flatMap((command) => {
      const tokens = command.trim().match(/(?:[^\s"'\\]|\\.|"(?:\\.|[^"])*"|'[^']*')+/g) ?? [];
      expect(tokens.slice(0, 2)).toEqual(["bun", "test"]);
      return tokens.slice(2).map((token): TestSelector => {
        const quote = token.at(0);
        const quoted = (quote === "'" || quote === '"') && token.at(-1) === quote;
        const value = (quoted ? token.slice(1, -1) : token).replace(/\\(.)/g, "$1");
        return { quoted, value };
      });
    });
    expect(expandedArguments.some(({ value }) => value === "-t"
      || value === "--only"
      || value.startsWith("--test-name-pattern"))).toBe(false);
    const selectors = expandedArguments.filter(({ value }) => !value.startsWith("-"));
    const discovered = ts.sys.readDirectory(resolve(repoRoot, "scripts"), [".ts"], undefined, ["*.test.ts"], 1);
    expect(discovered.length).toBeGreaterThan(0);
    if (selectors.length === 0) return;
    for (const name of discovered) {
      expect(
        selectors.some(selector => selectorSelectsFile(selector, name)),
        `script test not selected by test:runner: ${name}`,
      ).toBe(true);
    }
  });

  test("the shell test command enumerates every top-level shell regression", async () => {
    const packageJson = JSON.parse(await Bun.file(resolve(repoRoot, "package.json")).text()) as {
      scripts?: Record<string, string>;
    };
    const shellCommand = packageJson.scripts?.["test:shell"];
    expect(shellCommand).toBeDefined();
    const selected = new Set((shellCommand ?? "").split(/\s*&&\s*/).map((command) => command.trim()));
    const discovered = ts.sys.readDirectory(resolve(repoRoot, "scripts"), [".sh"], undefined, ["*.test.sh"], 1);
    expect(discovered.length).toBeGreaterThan(0);
    for (const name of discovered) {
      const repoRelative = relative(repoRoot, resolve(name));
      expect(selected.has(`bash ${repoRelative}`), `shell test not selected by test:shell: ${name}`).toBe(true);
    }
  });

  test("quoted glob selectors remain literal", () => {
    expect(selectorSelectsFile(
      { quoted: true, value: "scripts/*.test.ts" },
      resolve(repoRoot, "scripts/check-production-secrets.test.ts"),
    )).toBe(false);
  });

  test("coverage selectors stay repository-relative outside the repository cwd", () => {
    const previous = process.cwd();
    try {
      process.chdir(tmpdir());
      expect(selectorSelectsFile(
        { quoted: false, value: "scripts/check-production-secrets.test.ts" },
        resolve(repoRoot, "scripts/check-production-secrets.test.ts"),
      )).toBe(true);
    } finally {
      process.chdir(previous);
    }
  });
});
