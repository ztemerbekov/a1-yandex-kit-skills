import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Regression test for unref'd timers in KitClient: with no other ref'd handle
 * (no stdin transport, stub fetch), the rate-limiter refill timer and the
 * retry backoff sleep must keep the process alive by themselves. If either is
 * unref'd, the child exits mid-request with queued/retrying calls silently
 * dropped and never prints DONE.
 */
test("process stays alive through rate-limit queueing and retry backoff", async () => {
  const clientUrl = new URL("./client.ts", import.meta.url).href;
  const script = `
    import { KitClient } from ${JSON.stringify(clientUrl)};
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      const first = calls === 1;
      return new Response(
        JSON.stringify(first ? { code: "UNKNOWN_ERROR", message: "boom" } : { ok: true }),
        { status: first ? 500 : 200, headers: { "content-type": "application/json" } },
      );
    };
    // 25 concurrent calls at rps=20: 5 wait on the bucket refill timer, and
    // the first call retries once after a 50ms backoff sleep.
    const client = new KitClient({ token: "t", rps: 20, retryBaseMs: 50, fetchImpl });
    await Promise.all(
      Array.from({ length: 25 }, () => client.request({ method: "GET", path: "/v1/store" })),
    );
    console.log("DONE " + calls);
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: fileURLToPath(new URL(".", import.meta.url)), timeout: 15_000 },
  );
  assert.match(stdout, /DONE 26/); // 25 requests + 1 retry all completed
});
