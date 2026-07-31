import os from "node:os";
import path from "node:path";
import { hasConfigFormat } from "./config/index.mjs";
import {
  SERVER_NAME,
  SetupError,
  normalizeServerName,
} from "./shared.mjs";

export const CLIENT_PROFILES = [
  {
    id: "claude-code",
    aliases: ["claude", "claude-code"],
    format: "mcp-json",
    configPath: ({ home }) => path.join(home, ".claude.json"),
    check: {
      command: "claude",
      args: (serverName) => ["mcp", "get", serverName],
      optional: false,
      targeted: false,
    },
  },
  {
    id: "claude-desktop",
    aliases: ["claude-desktop"],
    format: "mcp-json",
    configPath: ({ configDir }) =>
      path.join(configDir, "Claude", "claude_desktop_config.json"),
  },
  {
    id: "cursor",
    aliases: ["cursor"],
    format: "mcp-json",
    configPath: ({ home }) => path.join(home, ".cursor", "mcp.json"),
    check: {
      command: "cursor-agent",
      args: () => ["mcp", "list"],
      optional: true,
      targeted: false,
    },
  },
  {
    id: "codex",
    aliases: ["codex", "openai-codex"],
    format: "codex-toml",
    configPath: ({ home, env }) =>
      path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml"),
    check: {
      command: "codex",
      args: () => ["mcp", "list", "--json"],
      optional: false,
      targeted: false,
      env: (configPath) => ({
        ...process.env,
        CODEX_HOME: path.dirname(configPath),
      }),
    },
  },
  {
    id: "vscode",
    aliases: ["vs-code", "vscode"],
    format: "vscode-json",
    configPath: ({ configDir }) =>
      path.join(configDir, "Code", "User", "mcp.json"),
  },
  {
    id: "kimi",
    aliases: ["kimi", "kimi-code"],
    format: "mcp-json",
    configPath: ({ home, env }) =>
      path.join(
        env.KIMI_CODE_HOME || path.join(home, ".kimi-code"),
        "mcp.json",
      ),
    check: {
      command: "kimi",
      args: (serverName) => ["mcp", "test", serverName],
      optional: true,
      targeted: true,
      env: (configPath) => ({
        ...process.env,
        KIMI_CODE_HOME: path.dirname(configPath),
      }),
    },
  },
  {
    id: "hermes",
    aliases: ["hermes", "hermes-agent"],
    format: "hermes-yaml",
    configPath: ({ home, env }) =>
      path.join(
        env.HERMES_HOME || path.join(home, ".hermes"),
        "config.yaml",
      ),
  },
  {
    id: "openclaw",
    aliases: ["openclaw"],
    format: "openclaw-json",
    configPath: ({ home }) =>
      path.join(home, ".openclaw", "openclaw.json"),
    check: {
      command: "openclaw",
      args: (serverName) => ["mcp", "doctor", serverName, "--probe"],
      optional: false,
      targeted: true,
    },
  },
];

const PROFILES_BY_ID = new Map(
  CLIENT_PROFILES.map((profile) => [profile.id, profile]),
);
const CLIENT_ALIASES = new Map(
  CLIENT_PROFILES.flatMap((profile) =>
    profile.aliases.map((alias) => [alias, profile.id]),
  ),
);

function platformConfigDir(platform, home, env) {
  if (platform === "win32") {
    return env.APPDATA || path.join(home, "AppData", "Roaming");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  return env.XDG_CONFIG_HOME || path.join(home, ".config");
}

export function normalizeClient(client) {
  const normalized = String(client || "").trim().toLowerCase();
  return CLIENT_ALIASES.get(normalized) ?? normalized;
}

export function getClientProfile(client) {
  return PROFILES_BY_ID.get(normalizeClient(client));
}

export function defaultConfigPath(
  client,
  {
    platform = process.platform,
    home = os.homedir(),
    env = process.env,
  } = {},
) {
  const profile = getClientProfile(client);
  if (!profile) {
    throw new SetupError(
      `No tested config path for client "${client}". Pass --format and --config.`,
      "UNKNOWN_CLIENT",
    );
  }
  return profile.configPath({
    platform,
    home,
    env,
    configDir: platformConfigDir(platform, home, env),
  });
}

export function resolveAdapter({
  client,
  format,
  configPath,
  platform,
  home,
  env,
  serverName,
  projectDir,
}) {
  const id = normalizeClient(client);
  const profile = getClientProfile(id);
  const resolvedFormat = format || profile?.format;
  if (!resolvedFormat || !hasConfigFormat(resolvedFormat)) {
    throw new SetupError(
      `Unsupported capability "${resolvedFormat || ""}".`,
      "UNSUPPORTED_FORMAT",
    );
  }
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : defaultConfigPath(id, { platform, home, env });
  return {
    client: id,
    format: resolvedFormat,
    configPath: resolvedPath,
    serverName: normalizeServerName(serverName),
    projectDir: path.resolve(projectDir || process.cwd()),
  };
}

export function getClientCheck(client, serverName, configPath) {
  const check = getClientProfile(client)?.check;
  if (!check) return undefined;
  return {
    command: check.command,
    args: check.args(serverName),
    optional: check.optional,
    targeted: check.targeted,
    env: check.env ? check.env(configPath) : process.env,
  };
}
