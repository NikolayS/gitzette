import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";

describe("TypeScript project coverage", () => {
  test("the runner project typechecks every runner test file", () => {
    const configPath = resolve("runner/tsconfig.json");
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(loaded.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve("runner"));
    const files = new Set(parsed.fileNames.map((name) => resolve(name)));
    for (const name of ts.sys.readDirectory(resolve("runner"), [".ts"], undefined, ["**/*.test.ts"])) {
      expect(files.has(resolve(name)), `runner test omitted from typecheck: ${name}`).toBe(true);
    }
  });

  test("the test project typechecks every top-level script", () => {
    const configPath = resolve("tsconfig.test.json");
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(loaded.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve("."));
    const files = new Set(parsed.fileNames.map((name) => resolve(name)));
    for (const name of ts.sys.readDirectory(resolve("scripts"), [".ts"], undefined, ["*.ts"], 1)) {
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
    const testArguments = tokens.slice(2);
    expect(testArguments.some(argument => argument === "-t"
      || argument.startsWith("--test-name-pattern")
      || argument === "--only")).toBe(false);
    const testPatterns = testArguments.filter(argument => !argument.startsWith("-"));
    expect(testPatterns.length).toBeGreaterThan(0);

    const discovered = ts.sys.readDirectory(resolve("scripts"), [".ts"], undefined, ["*.test.ts"], 1)
      .map(name => resolve(name)).sort();
    const matched = [...new Set(testPatterns.flatMap(pattern => [
      ...new Bun.Glob(pattern).scanSync({ cwd: resolve("."), absolute: true }),
    ]))].map(name => resolve(name)).filter(name => name.startsWith(resolve("scripts"))).sort();
    expect(matched).toEqual(discovered);
  });
});
