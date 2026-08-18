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

  test("the test project typechecks and executes every script test", async () => {
    const configPath = resolve("tsconfig.test.json");
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(loaded.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve("."));
    const files = new Set(parsed.fileNames.map((name) => resolve(name)));
    for (const name of ts.sys.readDirectory(resolve("scripts"), [".ts"], undefined, ["**/*.ts"])) {
      expect(files.has(resolve(name)), `script omitted from typecheck: ${name}`).toBe(true);
    }

    const packageJson = JSON.parse(await Bun.file(resolve("package.json")).text()) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["test:runner"]).toContain("bun test runner scripts/*.test.ts");
  });
});
