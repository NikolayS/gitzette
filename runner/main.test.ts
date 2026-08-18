import { describe, expect, test } from "bun:test";
import { runPollLoop } from "./main";

describe("runner polling loop", () => {
  test("backs off consecutive failures, resets after success, and stops without another claim", async () => {
    const results = ["failed", "failed", "processed"] as const;
    const delays: number[] = [];
    let calls = 0;
    let stopping = false;

    await runPollLoop({
      async runOnce() {
        const result = results[calls];
        calls += 1;
        if (!result) throw new Error("unexpected extra claim");
        return result;
      },
    }, 10, {
      isStopping: () => stopping,
      async sleep(milliseconds) {
        delays.push(milliseconds);
        if (delays.length === results.length) stopping = true;
      },
      log: () => {},
      logError: () => {},
    });

    expect(calls).toBe(3);
    expect(delays).toEqual([20_000, 40_000, 10_000]);
  });

  test("counts thrown outages as failures", async () => {
    const delays: number[] = [];
    let stopping = false;
    let calls = 0;
    await runPollLoop({
      async runOnce() {
        calls += 1;
        throw new Error("provider down");
      },
    }, 10, {
      isStopping: () => stopping,
      async sleep(milliseconds) {
        delays.push(milliseconds);
        if (delays.length === 2) stopping = true;
      },
      log: () => {},
      logError: () => {},
    });
    expect(calls).toBe(2);
    expect(delays).toEqual([20_000, 40_000]);
  });

  test("alerts exactly when three consecutive OAuth auth failures are reached", async () => {
    const results = ["auth_failed", "auth_failed", "auth_failed", "failed", "auth_failed"] as const;
    const alerts: string[] = [];
    let calls = 0;
    let stopping = false;
    await runPollLoop({
      async runOnce() { return results[calls++]; },
    }, 10, {
      isStopping: () => stopping,
      async sleep() { if (calls === results.length) stopping = true; },
      log: () => {},
      logError: (message) => alerts.push(message),
    });
    expect(alerts).toHaveLength(1);
    expect(JSON.parse(alerts[0])).toMatchObject({
      event: "oauth_auth_failure_alert",
      consecutiveAuthFailures: 3,
    });
  });
});
