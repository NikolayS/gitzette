import { describe, expect, test } from "bun:test";
import { relative, resolve } from "node:path";
import ts from "typescript";

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
    const testCommand = runnerCommand?.split(/\s*&&\s*/)
      .find(command => /^bun\s+test(?:\s|$)/.test(command.trim()));
    expect(testCommand).toBeDefined();
    const tokens = testCommand?.trim().match(/(?:[^\s"'\\]|\\.|"(?:\\.|[^"])*"|'[^']*')+/g) ?? [];
    expect(tokens.slice(0, 2)).toEqual(["bun", "test"]);
    const unquote = (token: string) => token.replace(/^(['"])([\s\S]*)\1$/, "$2").replace(/\\(.)/g, "$1");
    const expandedArguments = tokens.slice(2).map(unquote);
    expect(expandedArguments.some(argument => argument === "-t"
      || argument === "--only"
      || argument.startsWith("--test-name-pattern"))).toBe(false);
    const selectors = expandedArguments.filter(argument => !argument.startsWith("-"));
    const discovered = ts.sys.readDirectory(resolve("scripts"), [".ts"], undefined, ["*.test.ts"], 1);
    expect(discovered.length).toBeGreaterThan(0);
    if (selectors.length === 0) return;
    const globMatches = new Set(
      selectors.filter(selector => /[*?\[\]{}]/.test(selector)).flatMap(selector => [
        ...new Bun.Glob(selector).scanSync({ cwd: resolve("."), absolute: true }),
      ]).map(name => resolve(name)),
    );
    for (const name of discovered) {
      const repoRelativeName = relative(resolve("."), resolve(name));
      expect(
        globMatches.has(resolve(name))
          || selectors.some(selector => !/[*?\[\]{}]/.test(selector) && repoRelativeName.includes(selector)),
        `script test not selected by test:runner: ${name}`,
      ).toBe(true);
    }
  });
});
