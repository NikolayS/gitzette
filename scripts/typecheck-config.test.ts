import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import ts from "typescript";

const discoveryProbe = process.env.GITZETTE_TEST_DISCOVERY_PROBE === "1";

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
    if (discoveryProbe) {
      expect(true).toBe(true);
      return;
    }
    const packageJson = JSON.parse(await Bun.file(resolve("package.json")).text()) as {
      scripts?: Record<string, string>;
    };
    const runnerCommand = packageJson.scripts?.["test:runner"];
    expect(runnerCommand).toBeDefined();
    const testCommand = runnerCommand?.split(/\s*&&\s*/)
      .find(command => /^bun\s+test(?:\s|$)/.test(command.trim()));
    expect(testCommand).toBeDefined();
    const reportDirectory = await mkdtemp(resolve(tmpdir(), "gitzette-test-discovery-"));
    const reportPath = resolve(reportDirectory, "bun-test.xml");
    try {
      const child = Bun.spawn([
        "bash",
        "-c",
        `${testCommand} --reporter=junit --reporter-outfile="$GITZETTE_TEST_DISCOVERY_REPORT"`,
      ], {
        cwd: resolve("."),
        env: {
          ...process.env,
          GITZETTE_TEST_DISCOVERY_PROBE: "1",
          GITZETTE_TEST_DISCOVERY_REPORT: reportPath,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (exitCode !== 0) {
        throw new Error(`configured test command failed with ${exitCode}\n${stdout}\n${stderr}`);
      }
      const report = await Bun.file(reportPath).text();
      const executedFiles = new Set(
        [...report.matchAll(/<testsuite[^>]+file="([^"]+\.test\.ts)"/g)]
          .map(match => resolve(match[1])),
      );
      const discovered = ts.sys.readDirectory(resolve("scripts"), [".ts"], undefined, ["*.test.ts"], 1);
      for (const name of discovered) {
        expect(executedFiles.has(resolve(name)), `script test not executed: ${name}`).toBe(true);
      }
    } finally {
      await rm(reportDirectory, { recursive: true, force: true });
    }
  });
});
