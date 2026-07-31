import { spawn } from "node:child_process";
import { getClientCheck } from "./client-profiles.mjs";
import { inspectAdapter } from "./configuration.mjs";
import {
  SERVER_ARGS,
  SERVER_COMMAND,
  SERVER_NAME,
  TOKEN_PLACEHOLDER,
  SetupError,
  normalizeServerName,
  redactSecret,
} from "./shared.mjs";

export function assertNode20(version = process.versions.node) {
  const major = Number.parseInt(String(version).split(".")[0], 10);
  if (!Number.isInteger(major) || major < 20) {
    throw new SetupError(
      `Node.js 20 or newer is required; found ${version || "unknown"}.`,
      "NODE_VERSION",
    );
  }
}

export function buildSpawnInvocation(
  command,
  args,
  {
    platform = process.platform,
    env = process.env,
    windowsShim = false,
  } = {},
) {
  if (platform === "win32" && windowsShim) {
    return {
      command: env.ComSpec || env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}

export function spawnCaptured(
  command,
  args,
  {
    env,
    platform = process.platform,
    timeoutMs = 30_000,
    secret,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const invocation = buildSpawnInvocation(command, args, {
      env: env || process.env,
      platform,
      windowsShim: true,
    });
    const child = spawn(invocation.command, invocation.args, {
      env: env || process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      return next.length > 64_000 ? next.slice(-64_000) : next;
    };
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new SetupError(`Timed out running ${command}.`, "CLIENT_TIMEOUT"));
    }, timeoutMs);
    timer.unref();
    child.on("error", (error) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        resolve({ available: false, code: null, stdout: "", stderr: "" });
      } else {
        reject(
          new SetupError(
            redactSecret(
              `Could not run ${command}: ${error.message}`,
              secret,
            ),
            "CLIENT_CHECK",
          ),
        );
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        available: true,
        code,
        stdout: redactSecret(stdout, secret),
        stderr: redactSecret(stderr, secret),
      });
    });
  });
}

export async function checkPrerequisites({
  nodeVersion = process.versions.node,
  env = process.env,
  platform = process.platform,
  run = spawnCaptured,
} = {}) {
  assertNode20(nodeVersion);
  let result;
  try {
    result = await run(SERVER_COMMAND, ["--version"], {
      env,
      platform,
      timeoutMs: 10_000,
    });
  } catch {
    throw new SetupError(
      "npx is required before configuration. Install Node.js 20 or newer, restart the application, and try again.",
      "NPX_UNAVAILABLE",
    );
  }
  if (!result.available || result.code !== 0) {
    throw new SetupError(
      "npx is required before configuration. Install Node.js 20 or newer, restart the application, and try again.",
      "NPX_UNAVAILABLE",
    );
  }
  return {
    nodeVersion,
    npxAvailable: true,
    npxVersion: result.stdout.trim() || null,
  };
}

export async function configureNative({
  command,
  argsTemplate,
  token,
  serverName = SERVER_NAME,
  timeoutMs = 60_000,
  run = spawnCaptured,
}) {
  const managedName = normalizeServerName(serverName);
  if (
    typeof command !== "string" ||
    !command.trim() ||
    /[\0\r\n]/.test(command)
  ) {
    throw new SetupError(
      "Native configuration requires one executable name or path.",
      "INVALID_NATIVE_COMMAND",
    );
  }
  if (
    !Array.isArray(argsTemplate) ||
    argsTemplate.some(
      (argument) =>
        typeof argument !== "string" || /[\0\r\n]/.test(argument),
    )
  ) {
    throw new SetupError(
      "Native configuration arguments must be a JSON array of strings.",
      "INVALID_NATIVE_ARGUMENTS",
    );
  }
  if (!token) {
    throw new SetupError(
      "A Yandex KIT token is required on stdin.",
      "TOKEN_REQUIRED",
    );
  }
  if (!argsTemplate.some((argument) => argument.includes(TOKEN_PLACEHOLDER))) {
    throw new SetupError(
      `Native configuration arguments must contain ${TOKEN_PLACEHOLDER}.`,
      "TOKEN_PLACEHOLDER_REQUIRED",
    );
  }

  const args = argsTemplate.map((argument) =>
    argument.split(TOKEN_PLACEHOLDER).join(token),
  );
  const result = await run(command, args, {
    secret: token,
    timeoutMs,
  });
  if (!result.available) {
    throw new SetupError(
      `${command} is unavailable for native MCP configuration.`,
      "NATIVE_COMMAND_MISSING",
    );
  }
  if (result.code !== 0) {
    const diagnostic = redactSecret(
      `${result.stderr || ""}\n${result.stdout || ""}`.trim(),
      token,
    ).slice(-2_000);
    throw new SetupError(
      `${command} could not configure ${managedName}${
        diagnostic ? `: ${diagnostic}` : "."
      }`,
      "NATIVE_CONFIGURE_FAILED",
    );
  }
  return {
    configured: true,
    mode: "native-cli",
    command,
    serverName: managedName,
  };
}

export async function clientCheck(adapter, { run = spawnCaptured } = {}) {
  const state = await inspectAdapter(adapter);
  const serverName = adapter.serverName;
  if (!state.canonical) {
    throw new SetupError(
      `The ${serverName} entry is not canonical in ${adapter.configPath}.`,
      "CLIENT_CHECK",
    );
  }
  const check = getClientCheck(
    adapter.client,
    serverName,
    adapter.configPath,
  );
  if (!check) {
    return {
      ok: true,
      mode: "structural",
      client: adapter.client,
      configPath: adapter.configPath,
      serverName,
    };
  }
  const result = await run(check.command, check.args, {
    env: check.env,
    secret: state.token,
    timeoutMs: 60_000,
  });
  if (!result.available && check.optional) {
    return {
      ok: true,
      mode: "structural",
      client: adapter.client,
      configPath: adapter.configPath,
      serverName,
    };
  }
  if (!result.available) {
    throw new SetupError(
      `${check.command} is unavailable for the client-level check.`,
      "CLIENT_COMMAND_MISSING",
    );
  }
  if (result.code !== 0) {
    throw new SetupError(
      `${check.command} reported that the MCP configuration is not ready.`,
      "CLIENT_CHECK",
    );
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!check.targeted && !output.includes(serverName)) {
    throw new SetupError(
      `${check.command} did not find the ${serverName} server.`,
      "CLIENT_CHECK",
    );
  }
  if (
    adapter.client === "claude-code" &&
    (!output.includes(SERVER_COMMAND) ||
      !output.includes(SERVER_ARGS.at(-1)))
  ) {
    throw new SetupError(
      `Claude Code is using a different ${serverName} definition.`,
      "SERVER_SHADOWED",
    );
  }
  if (adapter.client === "codex") {
    try {
      const servers = JSON.parse(result.stdout);
      const server = Array.isArray(servers)
        ? servers.find((item) => item?.name === serverName)
        : undefined;
      if (!server || server.enabled === false) {
        throw new Error("server missing or disabled");
      }
    } catch {
      throw new SetupError(
        `Codex did not report an enabled ${serverName} server.`,
        "CLIENT_CHECK",
      );
    }
  }
  return {
    ok: true,
    mode: "native",
    client: adapter.client,
    serverName,
    command: [check.command, ...check.args].join(" "),
  };
}
