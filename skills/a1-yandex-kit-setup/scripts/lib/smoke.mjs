import { spawn } from "node:child_process";
import net from "node:net";

import { inspectAdapter } from "./configuration.mjs";
import { buildSpawnInvocation } from "./process.mjs";
import {
  SERVER_ARGS,
  SERVER_COMMAND,
  SetupError,
  TOKEN_KEY,
  redactSecret,
} from "./shared.mjs";

// The direct smoke needs both endpoints: npx resolves mcp-yandex-kit@latest
// against the npm registry, and get_store calls the Yandex KIT API.
const PROBE_TARGETS = [
  { host: "registry.npmjs.org", port: 443 },
  { host: "api.kit.yandex.net", port: 443 },
];

function probeTarget({ host, port }, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () =>
        finish(
          new SetupError(
            `External network is unavailable: connecting to ${host}:${port} timed out.`,
            "NETWORK_UNAVAILABLE",
          ),
        ),
      timeoutMs,
    );
    timer.unref();
    socket.once("connect", () => finish());
    socket.once("error", (error) =>
      finish(
        new SetupError(
          `External network is unavailable: ${host}:${port} is unreachable (${error.code || error.message}).`,
          "NETWORK_UNAVAILABLE",
        ),
      ),
    );
  });
}

export async function probeNetwork({
  targets = PROBE_TARGETS,
  timeoutMs = 5_000,
} = {}) {
  await Promise.all(targets.map((target) => probeTarget(target, timeoutMs)));
  return { networkOk: true };
}

function extractStore(toolResult, secret) {
  if (toolResult?.isError) {
    const failureText = toolResult.content
      ?.filter((item) => item?.type === "text")
      .map((item) => item.text)
      .join(" ");
    let status = null;
    try {
      const parsed = JSON.parse(failureText);
      if (typeof parsed?.status === "number") status = parsed.status;
    } catch {}
    if (status === 401 || status === 403) {
      throw new SetupError(
        `Yandex KIT rejected the token (HTTP ${status}).`,
        "SMOKE_AUTH",
      );
    }
    throw new SetupError(
      redactSecret(`get_store failed: ${failureText || "unknown MCP error"}`, secret),
      "SMOKE_TOOL_ERROR",
    );
  }
  const text = toolResult?.content?.find((item) => item?.type === "text")?.text;
  if (!text) {
    throw new SetupError("get_store returned no text result.", "SMOKE_RESULT");
  }
  try {
    const parsed = JSON.parse(text);
    const store =
      parsed?.store && typeof parsed.store === "object" ? parsed.store : parsed;
    return {
      id: store?.id ?? null,
      slug: store?.slug ?? null,
      name: store?.name ?? store?.title ?? null,
      url: store?.b2c_url ?? store?.url ?? null,
    };
  } catch {
    throw new SetupError("get_store returned invalid JSON.", "SMOKE_RESULT");
  }
}

// timeoutMs is one wall-clock budget for the whole smoke — the network probe,
// the child-process start, and the initialize → tools/list → get_store
// sequence share it, so per-step delays can never stack into minutes.
export async function smokeMcp({
  token,
  command = SERVER_COMMAND,
  args = SERVER_ARGS,
  timeoutMs = 60_000,
  probe = command === SERVER_COMMAND ? probeNetwork : null,
}) {
  if (!token) {
    throw new SetupError("A stored Yandex KIT token is required.", "TOKEN_REQUIRED");
  }

  const startedAt = Date.now();
  let child = null;
  const pending = new Map();
  const failPending = (error) => {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  };

  let deadlineTimer;
  const deadline = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => {
      reject(
        new SetupError(
          `The MCP smoke test did not finish within ${timeoutMs} ms.`,
          "SMOKE_TIMEOUT",
        ),
      );
    }, timeoutMs);
    deadlineTimer.unref();
  });

  const operation = (async () => {
    if (probe) await probe();

    const invocation = buildSpawnInvocation(command, args, {
      windowsShim: command === SERVER_COMMAND,
    });
    child = spawn(invocation.command, invocation.args, {
      env: { ...process.env, [TOKEN_KEY]: token },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => {});
    let nextId = 1;
    let stdoutBuffer = "";
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      while (stdoutBuffer.includes("\n")) {
        const newline = stdoutBuffer.indexOf("\n");
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          failPending(
            new SetupError(
              "The MCP server wrote non-protocol data to stdout.",
              "SMOKE_PROTOCOL",
            ),
          );
          continue;
        }
        if (message.id === undefined) continue;
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error) {
          request.reject(
            new SetupError(
              redactSecret(
                `MCP ${request.method} failed: ${message.error.message || "unknown error"}`,
                token,
              ),
              "SMOKE_PROTOCOL",
            ),
          );
        } else {
          request.resolve(message.result);
        }
      }
    });

    const request = (method, params) => {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      });
    };
    const notify = (method, params = {}) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    };

    const startError = new Promise((_, reject) => {
      child.once("error", (error) => {
        reject(
          new SetupError(
            redactSecret(`Could not start ${command}: ${error.message}`, token),
            "SMOKE_START",
          ),
        );
      });
      child.once("close", (code) => {
        if (pending.size > 0) {
          reject(
            new SetupError(
              redactSecret(
                `MCP server exited with code ${code}: ${stderr.trim().slice(-500)}`,
                token,
              ),
              "SMOKE_EXIT",
            ),
          );
        }
      });
    });

    const handshake = (async () => {
      const initialized = await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "a1-yandex-kit-setup", version: "1.0.0" },
      });
      notify("notifications/initialized");
      const listed = await request("tools/list", {});
      const tools = Array.isArray(listed?.tools) ? listed.tools : [];
      if (!tools.some((tool) => tool?.name === "get_store")) {
        throw new SetupError(
          "The MCP server did not advertise get_store.",
          "SMOKE_TOOLS",
        );
      }
      const result = await request("tools/call", {
        name: "get_store",
        arguments: {},
      });
      return {
        ok: true,
        protocolVersion: initialized?.protocolVersion ?? null,
        toolCount: tools.length,
        store: extractStore(result, token),
      };
    })();
    return await Promise.race([handshake, startError]);
  })();

  try {
    const result = await Promise.race([operation, deadline]);
    return { ...result, elapsedMs: Date.now() - startedAt };
  } finally {
    clearTimeout(deadlineTimer);
    failPending(new SetupError("MCP smoke test closed.", "SMOKE_CLOSED"));
    if (child) {
      try {
        child.stdin.end();
      } catch {}
      child.kill("SIGTERM");
    }
  }
}

export async function smokeAdapter(adapter, overrides = {}) {
  const state = await inspectAdapter(adapter);
  if (!state.token) {
    throw new SetupError(
      `No Yandex KIT token is configured in ${adapter.configPath}.`,
      "TOKEN_REQUIRED",
    );
  }
  return smokeMcp({ token: state.token, ...overrides });
}
