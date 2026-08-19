import { describe, expect, test } from "bun:test";
import { relative, resolve } from "node:path";
import ts from "typescript";

type TestSelector = { quoted: boolean; value: string };
const globMetacharacters = /[*?\[\]{}]/;

function selectorSelectsFile(selector: TestSelector, absoluteName: string): boolean {
  const repoRelativeName = relative(resolve("."), resolve(absoluteName));
  if (selector.quoted || !globMetacharacters.test(selector.value)) {
    return repoRelativeName.includes(selector.value);
  }
  return new Bun.Glob(selector.value).match(repoRelativeName);
}

describe("TypeScript project coverage", () => {
  test("the runner project typechecks every runner test file", () => {
    const configPath = resolve("runner/tsconfig.json");
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(loaded.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve("runner"));
    const files = new Set(parsed.fileNames.map((name) => resolve(name)));
    const discovered = ts.sys.readDirectory(resolve("runner"), [".ts"], undefined, ["**/*.test.ts"]);
    expect(discovered.length).toBeGreaterThan(0);
    for (const name of discovered) {
      expect(files.has(resolve(name)), `runner test omitted from typecheck: ${name}`).toBe(true);
    }
  });

  test("the test project typechecks every top-level script", () => {
    const configPath = resolve("tsconfig.test.json");
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(loaded.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve("."));
    const files = new Set(parsed.fileNames.map((name) => resolve(name)));
    const discovered = ts.sys.readDirectory(resolve("scripts"), [".ts"], undefined, ["*.ts"], 1);
    expect(discovered.length).toBeGreaterThan(0);
    for (const name of discovered) {
      expect(files.has(resolve(name)), `script omitted from typecheck: ${name}`).toBe(true);
    }
  });

  test("the test command discovers every top-level script test", async () => {
    const packageJson = JSON.parse(await Bun.file(resolve("package.json")).text()) as {
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
    const discovered = ts.sys.readDirectory(resolve("scripts"), [".ts"], undefined, ["*.test.ts"], 1);
    expect(discovered.length).toBeGreaterThan(0);
    if (selectors.length === 0) return;
    for (const name of discovered) {
      expect(
        selectors.some(selector => selectorSelectsFile(selector, name)),
        `script test not selected by test:runner: ${name}`,
      ).toBe(true);
    }
  });

  test("quoted glob selectors remain literal", () => {
    expect(selectorSelectsFile(
      { quoted: true, value: "scripts/*.test.ts" },
      resolve("scripts/check-production-secrets.test.ts"),
    )).toBe(false);
  });
});
