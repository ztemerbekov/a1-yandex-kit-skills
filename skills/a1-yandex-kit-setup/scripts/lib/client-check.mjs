import { getClientCheck } from "./client-profiles.mjs";
import { inspectAdapter } from "./configuration.mjs";
import { spawnCaptured } from "./process.mjs";
import {
  SERVER_ARGS,
  SERVER_COMMAND,
  SetupError,
} from "./shared.mjs";

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
