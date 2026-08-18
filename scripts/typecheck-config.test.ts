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
    expect(testCommand).not.toMatch(/[|<>]/);
    const argumentSource = testCommand?.trim().replace(/^bun\s+test(?:\s+|$)/, "") ?? "";
    expect(argumentSource.length).toBeGreaterThan(0);
    const child = Bun.spawn(["bash", "-c", `printf '%s\\0' ${argumentSource}`], {
      cwd: resolve("."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(`unable to expand configured test selectors (${exitCode}): ${stderr}`);
    }
    const expandedArguments = new TextDecoder().decode(stdout).split("\0").filter(Boolean);
    expect(expandedArguments.some(argument => argument === "-t"
      || argument === "--only"
      || argument.startsWith("--test-name-pattern"))).toBe(false);
    const selectors = expandedArguments.filter(argument => !argument.startsWith("-"));
    expect(selectors.length).toBeGreaterThan(0);
    const discovered = ts.sys.readDirectory(resolve("scripts"), [".ts"], undefined, ["*.test.ts"], 1);
    expect(discovered.length).toBeGreaterThan(0);
    for (const name of discovered) {
      const repoRelativeName = relative(resolve("."), resolve(name));
      expect(
        selectors.some(selector => repoRelativeName === selector || repoRelativeName.includes(selector)),
        `script test not selected by test:runner: ${name}`,
      ).toBe(true);
    }
  });
});
