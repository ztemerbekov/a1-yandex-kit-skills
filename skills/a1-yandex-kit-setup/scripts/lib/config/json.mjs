import {
  SERVER_ARGS,
  SERVER_COMMAND,
  SERVER_NAME,
  TOKEN_KEY,
  SetupError,
  configStatus,
} from "../shared.mjs";

export const JSON_ROOTS = {
  "mcp-json": ["mcpServers"],
  "vscode-json": ["servers"],
  "openclaw-json": ["mcp", "servers"],
};

export function parseJsonConfig(content, configPath) {
  if (!content.trim()) return {};
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("root is not an object");
    }
    return parsed;
  } catch (error) {
    throw new SetupError(
      `Cannot safely parse JSON config at ${configPath}: ${error.message}`,
      "MALFORMED_CONFIG",
    );
  }
}

function objectAt(root, keys, create = false) {
  let current = root;
  for (const key of keys) {
    const value = current[key];
    if (value === undefined && create) {
      current[key] = {};
    } else if (value === undefined) {
      return undefined;
    } else if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SetupError(
        `Expected "${keys.join(".")}" to be an object.`,
        "MALFORMED_CONFIG",
      );
    }
    current = current[key];
  }
  return current;
}

function jsonEntry(config, format, create = false, serverName = SERVER_NAME) {
  const servers = objectAt(config, JSON_ROOTS[format], create);
  if (!servers) return undefined;
  const existing = servers[serverName];
  if (existing === undefined && create) {
    servers[serverName] = {};
  } else if (
    existing !== undefined &&
    (!existing || typeof existing !== "object" || Array.isArray(existing))
  ) {
    throw new SetupError(
      `The "${serverName}" entry is not an object.`,
      "MALFORMED_CONFIG",
    );
  }
  return servers[serverName];
}

export function hasJsonServer(
  content,
  format,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const config = parseJsonConfig(content, configPath);
  const servers = objectAt(config, JSON_ROOTS[format], false);
  return Boolean(servers && Object.hasOwn(servers, serverName));
}

export function inspectJson(
  content,
  format,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const config = parseJsonConfig(content, configPath);
  const entry = jsonEntry(config, format, false, serverName);
  if (!entry) return configStatus({ entryPresent: false });

  const token = typeof entry.env?.[TOKEN_KEY] === "string"
    ? entry.env[TOKEN_KEY]
    : undefined;
  return configStatus({
    entryPresent: true,
    command: entry.command,
    args: entry.args,
    token,
    transportValid: format !== "vscode-json" || entry.type === "stdio",
  });
}

export function mergeJson(
  content,
  format,
  token,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const config = parseJsonConfig(content, configPath);
  const entry = jsonEntry(config, format, true, serverName);
  const env =
    entry.env === undefined
      ? {}
      : entry.env && typeof entry.env === "object" && !Array.isArray(entry.env)
        ? entry.env
        : (() => {
            throw new SetupError(
              `The "${serverName}.env" entry is not an object.`,
              "MALFORMED_CONFIG",
            );
          })();

  entry.command = SERVER_COMMAND;
  entry.args = [...SERVER_ARGS];
  entry.env = { ...env, [TOKEN_KEY]: token };
  if (format === "vscode-json") entry.type = "stdio";
  return `${JSON.stringify(config, null, 2)}\n`;
}
