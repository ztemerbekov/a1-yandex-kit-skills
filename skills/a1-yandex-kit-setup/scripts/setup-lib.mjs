import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SERVER_NAME = "yandex-kit";
export const FALLBACK_SERVER_NAME = "a1-yandex-kit-global";
export const TOKEN_KEY = "YANDEX_KIT_TOKEN";
export const SERVER_COMMAND = "npx";
export const SERVER_ARGS = ["-y", "mcp-yandex-kit@latest"];
export const BACKUP_SUFFIX = ".a1-yandex-kit-setup.bak";
export const TOKEN_PLACEHOLDER = "{{YANDEX_KIT_TOKEN}}";

const CLIENT_ALIASES = new Map([
  ["claude", "claude-code"],
  ["claude-code", "claude-code"],
  ["claude-desktop", "claude-desktop"],
  ["cursor", "cursor"],
  ["codex", "codex"],
  ["openai-codex", "codex"],
  ["vs-code", "vscode"],
  ["vscode", "vscode"],
  ["kimi", "kimi"],
  ["kimi-code", "kimi"],
  ["hermes", "hermes"],
  ["hermes-agent", "hermes"],
  ["openclaw", "openclaw"],
]);

const PROFILE_FORMATS = {
  "claude-code": "mcp-json",
  "claude-desktop": "mcp-json",
  cursor: "mcp-json",
  codex: "codex-toml",
  vscode: "vscode-json",
  kimi: "mcp-json",
  hermes: "hermes-yaml",
  openclaw: "openclaw-json",
};

const JSON_ROOTS = {
  "mcp-json": ["mcpServers"],
  "vscode-json": ["servers"],
  "openclaw-json": ["mcp", "servers"],
};

export class SetupError extends Error {
  constructor(message, code = "SETUP_ERROR") {
    super(message);
    this.name = "SetupError";
    this.code = code;
  }
}

export function assertNode20(version = process.versions.node) {
  const major = Number.parseInt(String(version).split(".")[0], 10);
  if (!Number.isInteger(major) || major < 20) {
    throw new SetupError(
      `Node.js 20 or newer is required; found ${version || "unknown"}.`,
      "NODE_VERSION",
    );
  }
}

export function normalizeClient(client) {
  const normalized = String(client || "").trim().toLowerCase();
  return CLIENT_ALIASES.get(normalized) ?? normalized;
}

function normalizeServerName(serverName = SERVER_NAME) {
  const normalized = String(serverName || "").trim();
  if (![SERVER_NAME, FALLBACK_SERVER_NAME].includes(normalized)) {
    throw new SetupError(
      `Unsupported managed server name "${normalized}".`,
      "INVALID_SERVER_NAME",
    );
  }
  return normalized;
}

function platformConfigDir(platform, home, env) {
  if (platform === "win32") {
    return env.APPDATA || path.join(home, "AppData", "Roaming");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  return env.XDG_CONFIG_HOME || path.join(home, ".config");
}

export function defaultConfigPath(
  client,
  {
    platform = process.platform,
    home = os.homedir(),
    env = process.env,
  } = {},
) {
  const id = normalizeClient(client);
  const configDir = platformConfigDir(platform, home, env);

  switch (id) {
    case "claude-code":
      return path.join(home, ".claude.json");
    case "claude-desktop":
      if (platform === "win32") {
        return path.join(configDir, "Claude", "claude_desktop_config.json");
      }
      return path.join(configDir, "Claude", "claude_desktop_config.json");
    case "cursor":
      return path.join(home, ".cursor", "mcp.json");
    case "codex":
      return path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml");
    case "vscode":
      return path.join(configDir, "Code", "User", "mcp.json");
    case "kimi":
      return path.join(env.KIMI_CODE_HOME || path.join(home, ".kimi-code"), "mcp.json");
    case "hermes":
      return path.join(env.HERMES_HOME || path.join(home, ".hermes"), "config.yaml");
    case "openclaw":
      return path.join(home, ".openclaw", "openclaw.json");
    default:
      throw new SetupError(
        `No tested config path for client "${client}". Pass --format and --config.`,
        "UNKNOWN_CLIENT",
      );
  }
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
  const resolvedFormat = format || PROFILE_FORMATS[id];
  if (!resolvedFormat || !Object.hasOwn(JSON_ROOTS, resolvedFormat) &&
      !["codex-toml", "hermes-yaml"].includes(resolvedFormat)) {
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

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function contentHash(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function parseJsonConfig(content, configPath) {
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

export function inspectJson(
  content,
  format,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const config = parseJsonConfig(content, configPath);
  let entry;
  try {
    entry = jsonEntry(config, format, false, serverName);
  } catch (error) {
    if (
      error instanceof SetupError &&
      error.code === "MALFORMED_CONFIG" &&
      !content.trim()
    ) {
      entry = undefined;
    } else {
      throw error;
    }
  }
  if (!entry) {
    return {
      entryPresent: false,
      configured: false,
      canonical: false,
      tokenPresent: false,
      token: undefined,
    };
  }
  const token = typeof entry.env?.[TOKEN_KEY] === "string"
    ? entry.env[TOKEN_KEY]
    : undefined;
  const canonical =
    entry.command === SERVER_COMMAND &&
    Array.isArray(entry.args) &&
    entry.args.length === SERVER_ARGS.length &&
    entry.args.every((value, index) => value === SERVER_ARGS[index]) &&
    Boolean(token) &&
    (format !== "vscode-json" || entry.type === "stdio");
  return {
    entryPresent: true,
    configured: Boolean(token),
    canonical,
    tokenPresent: Boolean(token),
    token,
  };
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

function parseTomlDottedKey(name) {
  const rawParts = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const char of name.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      continue;
    }
    if (char === "." && !quote) {
      rawParts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quote || escaped || !current.trim()) return undefined;
  rawParts.push(current.trim());
  const parts = [];
  for (const part of rawParts) {
    if (/^[A-Za-z0-9_-]+$/.test(part)) {
      parts.push(part);
      continue;
    }
    if (part.startsWith('"')) {
      try {
        const parsed = JSON.parse(part);
        if (typeof parsed !== "string") return undefined;
        parts.push(parsed);
        continue;
      } catch {
        return undefined;
      }
    }
    if (part.startsWith("'") && part.endsWith("'") && part.length >= 2) {
      parts.push(part.slice(1, -1));
      continue;
    }
    return undefined;
  }
  return parts;
}

function normalizeTomlTableName(name) {
  return parseTomlDottedKey(name)?.join(".") ?? name.trim();
}

function stripCommentOutsideQuotes(value, configPath, syntax) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote === "'" && char === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      continue;
    }
    if (char === "#" && !quote) return value.slice(0, index).trimEnd();
  }
  if (quote || escaped) {
    throw new SetupError(
      `Cannot safely parse ${syntax} config at ${configPath}: unterminated string.`,
      "MALFORMED_CONFIG",
    );
  }
  return value.trimEnd();
}

function validTomlValue(raw, configPath) {
  const value = stripCommentOutsideQuotes(raw, configPath, "TOML").trim();
  if (!value) return false;
  if (value.startsWith('"')) {
    try {
      return typeof JSON.parse(value) === "string";
    } catch {
      return false;
    }
  }
  if (value.startsWith("'")) {
    return value.length >= 2 && value.endsWith("'");
  }
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      const safeItem = (item) =>
        item === null ||
        ["string", "number", "boolean"].includes(typeof item) ||
        Array.isArray(item) && item.every(safeItem);
      return Array.isArray(parsed) && parsed.every(safeItem);
    } catch {
      return false;
    }
  }
  if (value.startsWith("{")) return false;
  return (
    /^(?:true|false)$/.test(value) ||
    /^[+-]?(?:inf|nan)$/.test(value) ||
    /^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.(?:\d(?:_?\d)*))?(?:[eE][+-]?\d(?:_?\d)*)?$/.test(value) ||
    /^0(?:x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|o[0-7](?:_?[0-7])*|b[01](?:_?[01])*)$/.test(value) ||
    /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?$/.test(value) ||
    /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
  );
}

function splitTomlAssignment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      continue;
    }
    if (char === "=" && !quote) {
      const keyParts = parseTomlDottedKey(line.slice(0, index));
      const value = line.slice(index + 1);
      return keyParts && value.trim() ? { keyParts, value } : undefined;
    }
  }
  return undefined;
}

function validateTomlSubset(content, configPath) {
  const chunks = splitToml(content, configPath);
  const tables = new Set();
  for (const chunk of chunks) {
    if (chunk.header) {
      const header = chunk.header.match(
        /^\s*(\[\[?)(.+?)(\]\]?)(?:\s*#.*)?$/,
      );
      const tableParts = header ? parseTomlDottedKey(header[2]) : undefined;
      if (
        !header ||
        !tableParts ||
        (header[1] === "[[" && header[3] !== "]]") ||
        (header[1] === "[" && header[3] !== "]")
      ) {
        throw new SetupError(
          `Cannot safely update TOML config at ${configPath}: unsupported table syntax.`,
          "MALFORMED_CONFIG",
        );
      }
      const tableId = JSON.stringify(tableParts);
      if (!chunk.array && tables.has(tableId)) {
        throw new SetupError(
          `Cannot safely update duplicate TOML table [${chunk.name}] at ${configPath}.`,
          "MALFORMED_CONFIG",
        );
      }
      if (!chunk.array) tables.add(tableId);
    }

    const keys = new Set();
    for (const line of chunk.body) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const assignment = splitTomlAssignment(line);
      if (!assignment || !validTomlValue(assignment.value, configPath)) {
        throw new SetupError(
          `Cannot safely parse TOML config at ${configPath}: unsupported or invalid assignment.`,
          "MALFORMED_CONFIG",
        );
      }
      const keyId = JSON.stringify(assignment.keyParts);
      if (keys.has(keyId)) {
        throw new SetupError(
          `Cannot safely update duplicate TOML key at ${configPath}.`,
          "MALFORMED_CONFIG",
        );
      }
      keys.add(keyId);
    }
  }
  return chunks;
}

function splitToml(content, configPath) {
  const chunks = [{ header: null, name: null, array: false, body: [] }];
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      const match = line.match(/^\s*(\[\[?)(.+?)(\]\]?)(?:\s*#.*)?$/);
      if (!match || (match[1] === "[[" && match[3] !== "]]") ||
          (match[1] === "[" && match[3] !== "]")) {
        throw new SetupError(
          `Cannot safely parse TOML config at ${configPath}: invalid table header.`,
          "MALFORMED_CONFIG",
        );
      }
      chunks.push({
        header: line,
        name: normalizeTomlTableName(match[2]),
        array: match[1] === "[[",
        body: [],
      });
    } else {
      chunks.at(-1).body.push(line);
    }
  }
  return chunks;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function parseTomlString(value) {
  const raw = value.trim().replace(/\s+#.*$/, "");
  if (!raw.startsWith('"')) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function tomlAssignment(body, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^\\s*${escaped}\\s*=\\s*(.+?)\\s*$`);
  for (const line of body) {
    const match = line.match(regex);
    if (match) return match[1];
  }
  return undefined;
}

function bracketBalance(value) {
  let balance = 0;
  let quoted = false;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === "[" || char === "{")) balance += 1;
    if (!quoted && (char === "]" || char === "}")) balance -= 1;
  }
  return balance;
}

function removeTomlAssignments(body, keys, configPath) {
  const result = [];
  for (let index = 0; index < body.length; index += 1) {
    const match = body[index].match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!match || !keys.has(match[1])) {
      result.push(body[index]);
      continue;
    }
    if (match[2].includes('"""') || match[2].includes("'''")) {
      throw new SetupError(
        `Cannot safely update multiline TOML value at ${configPath}.`,
        "MALFORMED_CONFIG",
      );
    }
    let balance = bracketBalance(match[2]);
    while (balance > 0) {
      index += 1;
      if (index >= body.length) {
        throw new SetupError(
          `Cannot safely parse TOML config at ${configPath}: unfinished value.`,
          "MALFORMED_CONFIG",
        );
      }
      balance += bracketBalance(body[index]);
    }
    if (balance < 0) {
      throw new SetupError(
        `Cannot safely parse TOML config at ${configPath}: invalid value.`,
        "MALFORMED_CONFIG",
      );
    }
  }
  return result;
}

function uniqueTomlChunk(chunks, name, configPath) {
  const matches = chunks.filter((chunk) => !chunk.array && chunk.name === name);
  if (matches.length > 1) {
    throw new SetupError(
      `Cannot safely update duplicate TOML table [${name}] at ${configPath}.`,
      "MALFORMED_CONFIG",
    );
  }
  return matches[0];
}

function parseTomlArgs(value) {
  if (!value) return undefined;
  const withoutComment = value.replace(/\s+#.*$/, "").trim();
  try {
    const parsed = JSON.parse(withoutComment);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function inspectToml(
  content,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const chunks = validateTomlSubset(content, configPath);
  const server = uniqueTomlChunk(
    chunks,
    `mcp_servers.${serverName}`,
    configPath,
  );
  const env = uniqueTomlChunk(
    chunks,
    `mcp_servers.${serverName}.env`,
    configPath,
  );
  if (!server) {
    return {
      entryPresent: false,
      configured: false,
      canonical: false,
      tokenPresent: false,
      token: undefined,
    };
  }
  const command = parseTomlString(tomlAssignment(server.body, "command") || "");
  const args = parseTomlArgs(tomlAssignment(server.body, "args"));
  const token = env
    ? parseTomlString(tomlAssignment(env.body, TOKEN_KEY) || "")
    : undefined;
  return {
    entryPresent: true,
    configured: Boolean(token),
    canonical:
      command === SERVER_COMMAND &&
      Array.isArray(args) &&
      args.length === SERVER_ARGS.length &&
      args.every((value, index) => value === SERVER_ARGS[index]) &&
      Boolean(token),
    tokenPresent: Boolean(token),
    token,
  };
}

function renderToml(chunks) {
  const lines = [];
  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) lines.push(chunk.header);
    lines.push(...chunk.body);
  }
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

export function mergeToml(
  content,
  token,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const chunks = validateTomlSubset(content, configPath);
  let server = uniqueTomlChunk(
    chunks,
    `mcp_servers.${serverName}`,
    configPath,
  );
  let env = uniqueTomlChunk(
    chunks,
    `mcp_servers.${serverName}.env`,
    configPath,
  );

  if (!server) {
    server = {
      header: `[mcp_servers.${serverName}]`,
      name: `mcp_servers.${serverName}`,
      array: false,
      body: [],
    };
    chunks.push(server);
  }
  if (!env) {
    env = {
      header: `[mcp_servers.${serverName}.env]`,
      name: `mcp_servers.${serverName}.env`,
      array: false,
      body: [],
    };
    const serverIndex = chunks.indexOf(server);
    chunks.splice(serverIndex + 1, 0, env);
  }

  const serverPreserved = removeTomlAssignments(
    server.body,
    new Set(["command", "args"]),
    configPath,
  ).filter((line, index, lines) =>
    line !== "" || (index > 0 && index < lines.length - 1)
  );
  const envPreserved = removeTomlAssignments(
    env.body,
    new Set([TOKEN_KEY]),
    configPath,
  ).filter((line, index, lines) =>
    line !== "" || (index > 0 && index < lines.length - 1)
  );

  server.body = [
    `command = ${tomlString(SERVER_COMMAND)}`,
    `args = ${JSON.stringify(SERVER_ARGS)}`,
    ...serverPreserved,
  ];
  env.body = [
    `${TOKEN_KEY} = ${tomlString(token)}`,
    ...envPreserved,
  ];
  return renderToml(chunks);
}

function indentation(line) {
  return line.match(/^ */)[0].length;
}

function yamlScalar(value) {
  const raw = value.trim().replace(/\s+#.*$/, "");
  if (raw.startsWith('"')) {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw || undefined;
}

function validYamlFlowSequence(value, configPath) {
  if (!value.endsWith("]")) return false;
  const inner = value.slice(1, -1).trim();
  if (!inner) return true;
  const items = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote === "'" && char === "'" && inner[index + 1] === "'") {
      current += "''";
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      continue;
    }
    if (char === "," && !quote) {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quote || escaped) return false;
  items.push(current.trim());
  return items.every((item) => {
    if (!item || item.startsWith("[") || item.startsWith("{")) return false;
    if (item.startsWith('"')) {
      try {
        return typeof JSON.parse(item) === "string";
      } catch {
        return false;
      }
    }
    if (item.startsWith("'")) return item.length >= 2 && item.endsWith("'");
    return !/[\[\]{},]/.test(item);
  });
}

function validYamlValue(raw, configPath) {
  const value = stripCommentOutsideQuotes(raw, configPath, "YAML").trim();
  if (!value) return { mapping: true, blockScalar: false };
  if (/^[|>][+-]?\d?$|^[|>]\d[+-]?$/.test(value)) {
    return { mapping: false, blockScalar: true };
  }
  if (value.startsWith("{")) return false;
  if (value.startsWith("[")) {
    return validYamlFlowSequence(value, configPath)
      ? { mapping: false, blockScalar: false }
      : false;
  }
  if (value.startsWith('"')) {
    try {
      return typeof JSON.parse(value) === "string"
        ? { mapping: false, blockScalar: false }
        : false;
    } catch {
      return false;
    }
  }
  if (value.startsWith("'")) {
    return value.length >= 2 && value.endsWith("'")
      ? { mapping: false, blockScalar: false }
      : false;
  }
  if (/^[*&!]/.test(value) || /^(?:---|\.\.\.)$/.test(value)) return false;
  return { mapping: false, blockScalar: false };
}

function validateYamlSubset(content, configPath) {
  if (content.includes("\t")) {
    throw new SetupError(
      `Cannot safely parse YAML config at ${configPath}: tabs are present.`,
      "MALFORMED_CONFIG",
    );
  }
  const contexts = [{ indent: -1, keys: new Set() }];
  let blockScalarIndent = null;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = indentation(line);
    if (blockScalarIndent !== null && indent > blockScalarIndent) continue;
    blockScalarIndent = null;
    const trimmed = line.trim();
    if (trimmed.startsWith("-")) {
      throw new SetupError(
        `Cannot safely update YAML config at ${configPath}: block sequences are unsupported.`,
        "MALFORMED_CONFIG",
      );
    }
    const match = trimmed.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) {
      throw new SetupError(
        `Cannot safely parse YAML config at ${configPath}: unsupported mapping syntax.`,
        "MALFORMED_CONFIG",
      );
    }
    while (contexts.length > 1 && contexts.at(-1).indent >= indent) {
      contexts.pop();
    }
    const parent = contexts.at(-1);
    if (indent <= parent.indent || parent.keys.has(match[1])) {
      throw new SetupError(
        `Cannot safely update duplicate or mis-indented YAML key "${match[1]}" at ${configPath}.`,
        "MALFORMED_CONFIG",
      );
    }
    const valueState = validYamlValue(match[2] ?? "", configPath);
    if (!valueState) {
      throw new SetupError(
        `Cannot safely parse YAML config at ${configPath}: unsupported or invalid value.`,
        "MALFORMED_CONFIG",
      );
    }
    parent.keys.add(match[1]);
    if (valueState.mapping) {
      contexts.push({ indent, keys: new Set() });
    } else if (valueState.blockScalar) {
      blockScalarIndent = indent;
    }
  }
}

function locateYaml(content, configPath, serverName = SERVER_NAME) {
  validateYamlSubset(content, configPath);
  const lines = content.split(/\r?\n/);
  const roots = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^mcp_servers:\s*(?:#.*)?$/.test(lines[index])) roots.push(index);
  }
  if (roots.length > 1) {
    throw new SetupError(
      `Cannot safely update duplicate YAML key mcp_servers at ${configPath}.`,
      "MALFORMED_CONFIG",
    );
  }
  if (roots.length === 0) return { lines, rootStart: -1 };

  const rootStart = roots[0];
  let rootEnd = lines.length;
  for (let index = rootStart + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed && !trimmed.startsWith("#") && indentation(lines[index]) === 0) {
      rootEnd = index;
      break;
    }
  }

  const targets = [];
  const escapedServerName = serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const serverPattern = new RegExp(
    `^(\\s+)${escapedServerName}:\\s*(?:#.*)?$`,
  );
  for (let index = rootStart + 1; index < rootEnd; index += 1) {
    const match = lines[index].match(serverPattern);
    if (match) targets.push({ index, indent: match[1].length });
  }
  if (targets.length > 1) {
    throw new SetupError(
      `Cannot safely update duplicate YAML server ${serverName} at ${configPath}.`,
      "MALFORMED_CONFIG",
    );
  }
  if (targets.length === 0) {
    return { lines, rootStart, rootEnd, targetStart: -1, childIndent: 2 };
  }

  const targetStart = targets[0].index;
  const childIndent = targets[0].indent;
  let targetEnd = rootEnd;
  for (let index = targetStart + 1; index < rootEnd; index += 1) {
    const trimmed = lines[index].trim();
    if (
      trimmed &&
      !trimmed.startsWith("#") &&
      indentation(lines[index]) <= childIndent
    ) {
      targetEnd = index;
      break;
    }
  }
  return {
    lines,
    rootStart,
    rootEnd,
    targetStart,
    targetEnd,
    childIndent,
  };
}

function yamlField(block, key, fieldIndent) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^ {${fieldIndent}}${escaped}:\\s*(.*)$`);
  for (let index = 0; index < block.length; index += 1) {
    const match = block[index].match(regex);
    if (!match) continue;
    let end = block.length;
    for (let cursor = index + 1; cursor < block.length; cursor += 1) {
      const trimmed = block[cursor].trim();
      if (
        trimmed &&
        !trimmed.startsWith("#") &&
        indentation(block[cursor]) <= fieldIndent
      ) {
        end = cursor;
        break;
      }
    }
    return { start: index, end, value: match[1] };
  }
  return undefined;
}

function removeYamlFields(block, keys, fieldIndent) {
  const spans = keys
    .map((key) => yamlField(block, key, fieldIndent))
    .filter(Boolean)
    .sort((a, b) => b.start - a.start);
  const output = [...block];
  for (const span of spans) output.splice(span.start, span.end - span.start);
  return output;
}

export function inspectYaml(
  content,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const located = locateYaml(content, configPath, serverName);
  if (located.targetStart === undefined || located.targetStart < 0) {
    return {
      entryPresent: false,
      configured: false,
      canonical: false,
      tokenPresent: false,
      token: undefined,
    };
  }
  const block = located.lines.slice(located.targetStart + 1, located.targetEnd);
  const fieldIndent = located.childIndent + 2;
  const commandField = yamlField(block, "command", fieldIndent);
  const argsField = yamlField(block, "args", fieldIndent);
  const envField = yamlField(block, "env", fieldIndent);
  const command = commandField ? yamlScalar(commandField.value) : undefined;
  let args;
  if (argsField?.value) {
    try {
      args = JSON.parse(argsField.value.replace(/\s+#.*$/, ""));
    } catch {
      args = undefined;
    }
  }
  let token;
  if (envField) {
    const envBlock = block.slice(envField.start + 1, envField.end);
    const tokenField = yamlField(envBlock, TOKEN_KEY, fieldIndent + 2);
    token = tokenField ? yamlScalar(tokenField.value) : undefined;
  }
  return {
    entryPresent: true,
    configured: Boolean(token),
    canonical:
      command === SERVER_COMMAND &&
      Array.isArray(args) &&
      args.length === SERVER_ARGS.length &&
      args.every((value, index) => value === SERVER_ARGS[index]) &&
      Boolean(token),
    tokenPresent: Boolean(token),
    token,
  };
}

export function mergeYaml(
  content,
  token,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const located = locateYaml(content, configPath, serverName);
  const tokenLine = `${TOKEN_KEY}: ${JSON.stringify(token)}`;
  if (located.rootStart < 0) {
    const prefix = content.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}mcp_servers:\n` +
      `  ${serverName}:\n` +
      `    command: ${JSON.stringify(SERVER_COMMAND)}\n` +
      `    args: ${JSON.stringify(SERVER_ARGS)}\n` +
      `    env:\n` +
      `      ${tokenLine}\n`;
  }

  if (located.targetStart < 0) {
    const insert = [
      `  ${serverName}:`,
      `    command: ${JSON.stringify(SERVER_COMMAND)}`,
      `    args: ${JSON.stringify(SERVER_ARGS)}`,
      "    env:",
      `      ${tokenLine}`,
    ];
    const lines = [...located.lines];
    lines.splice(located.rootEnd, 0, ...insert);
    while (lines.length > 0 && lines.at(-1) === "") lines.pop();
    return `${lines.join("\n")}\n`;
  }

  const block = located.lines.slice(located.targetStart + 1, located.targetEnd);
  const fieldIndent = located.childIndent + 2;
  const envField = yamlField(block, "env", fieldIndent);
  let preservedEnv = [];
  if (envField) {
    const envBlock = block.slice(envField.start + 1, envField.end);
    preservedEnv = removeYamlFields(
      envBlock,
      [TOKEN_KEY],
      fieldIndent + 2,
    );
  }
  const preserved = removeYamlFields(
    block,
    ["command", "args", "env"],
    fieldIndent,
  );
  const pad = " ".repeat(fieldIndent);
  const envPad = " ".repeat(fieldIndent + 2);
  const replacement = [
    located.lines[located.targetStart],
    `${pad}command: ${JSON.stringify(SERVER_COMMAND)}`,
    `${pad}args: ${JSON.stringify(SERVER_ARGS)}`,
    `${pad}env:`,
    `${envPad}${tokenLine}`,
    ...preservedEnv,
    ...preserved,
  ];
  const lines = [...located.lines];
  lines.splice(
    located.targetStart,
    located.targetEnd - located.targetStart,
    ...replacement,
  );
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function inspectContent(content, format, configPath, serverName = SERVER_NAME) {
  if (Object.hasOwn(JSON_ROOTS, format)) {
    return inspectJson(content, format, configPath, serverName);
  }
  if (format === "codex-toml") {
    return inspectToml(content, configPath, serverName);
  }
  if (format === "hermes-yaml") {
    return inspectYaml(content, configPath, serverName);
  }
  throw new SetupError(`Unsupported capability "${format}".`, "UNSUPPORTED_FORMAT");
}

function mergeContent(
  content,
  format,
  token,
  configPath,
  serverName = SERVER_NAME,
) {
  if (Object.hasOwn(JSON_ROOTS, format)) {
    return mergeJson(content, format, token, configPath, serverName);
  }
  if (format === "codex-toml") {
    return mergeToml(content, token, configPath, serverName);
  }
  if (format === "hermes-yaml") {
    return mergeYaml(content, token, configPath, serverName);
  }
  throw new SetupError(`Unsupported capability "${format}".`, "UNSUPPORTED_FORMAT");
}

export async function inspectAdapter(adapter) {
  const exists = await fileExists(adapter.configPath);
  const content = exists ? await readFile(adapter.configPath, "utf8") : "";
  const state = inspectContent(
    content,
    adapter.format,
    adapter.configPath,
    adapter.serverName,
  );
  return {
    client: adapter.client,
    format: adapter.format,
    configPath: adapter.configPath,
    serverName: adapter.serverName,
    configExists: exists,
    configured: state.configured,
    entryPresent: state.entryPresent,
    canonical: state.canonical,
    tokenPresent: state.tokenPresent,
    token: state.token,
  };
}

function ancestorDirectories(directory) {
  const directories = [];
  let current = path.resolve(directory);
  while (true) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) return directories;
    current = parent;
  }
}

function directoryContains(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === "" ||
    relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
  );
}

async function jsonFileHasServer(configPath, format, serverName) {
  if (!(await fileExists(configPath))) return false;
  try {
    const config = parseJsonConfig(await readFile(configPath, "utf8"), configPath);
    const servers = objectAt(config, JSON_ROOTS[format], false);
    return Boolean(servers && Object.hasOwn(servers, serverName));
  } catch (error) {
    if (error instanceof SetupError && error.code === "MALFORMED_CONFIG") {
      return false;
    }
    throw error;
  }
}

async function claudeLocalHasServer(adapter, serverName) {
  if (adapter.client !== "claude-code" ||
      !(await fileExists(adapter.configPath))) {
    return false;
  }
  try {
    const config = parseJsonConfig(
      await readFile(adapter.configPath, "utf8"),
      adapter.configPath,
    );
    if (!config.projects || typeof config.projects !== "object" ||
        Array.isArray(config.projects)) {
      return false;
    }
    return Object.entries(config.projects).some(([projectPath, project]) =>
      directoryContains(projectPath, adapter.projectDir) &&
      project &&
      typeof project === "object" &&
      !Array.isArray(project) &&
      project.mcpServers &&
      typeof project.mcpServers === "object" &&
      !Array.isArray(project.mcpServers) &&
      Object.hasOwn(project.mcpServers, serverName)
    );
  } catch (error) {
    if (error instanceof SetupError && error.code === "MALFORMED_CONFIG") {
      return false;
    }
    throw error;
  }
}

async function projectFileHasServer(adapter, serverName) {
  const relativeConfig =
    adapter.client === "claude-code"
      ? [".mcp.json", "mcp-json"]
      : adapter.client === "cursor"
        ? [path.join(".cursor", "mcp.json"), "mcp-json"]
        : adapter.client === "vscode"
          ? [path.join(".vscode", "mcp.json"), "vscode-json"]
          : adapter.client === "kimi"
            ? [path.join(".kimi-code", "mcp.json"), "mcp-json"]
          : null;
  if (!relativeConfig) return false;
  const [relativePath, format] = relativeConfig;
  for (const directory of ancestorDirectories(adapter.projectDir)) {
    const candidate = path.join(directory, relativePath);
    if (path.resolve(candidate) === path.resolve(adapter.configPath)) continue;
    if (await jsonFileHasServer(candidate, format, serverName)) return true;
  }
  return false;
}

export async function projectShadowsServer(
  adapter,
  serverName = adapter.serverName,
) {
  return (
    await claudeLocalHasServer(adapter, serverName) ||
    await projectFileHasServer(adapter, serverName)
  );
}

export async function selectManagedAdapter(adapter) {
  if (adapter.serverName !== SERVER_NAME) return adapter;

  const fallback = { ...adapter, serverName: FALLBACK_SERVER_NAME };
  const fallbackState = await inspectAdapter(fallback);
  if (fallbackState.canonical) return fallback;

  if (await projectShadowsServer(adapter, SERVER_NAME)) {
    return fallback;
  }
  return adapter;
}

async function transactionalWrite(configPath, content, verify) {
  const existed = await fileExists(configPath);
  const previous = existed ? await readFile(configPath, "utf8") : "";
  if (previous === content) {
    return { changed: false, created: false, backupPath: null };
  }

  await mkdir(path.dirname(configPath), { recursive: true });
  const backupPath = existed ? `${configPath}${BACKUP_SUFFIX}` : null;
  const previousMode = existed ? (await stat(configPath)).mode & 0o777 : 0o600;
  const secureMode = 0o600;
  if (backupPath) {
    await copyFile(configPath, backupPath);
    await chmod(backupPath, secureMode);
  }

  const tempPath = `${configPath}.a1-yandex-kit-setup.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, content, { encoding: "utf8", mode: secureMode });
    await rename(tempPath, configPath);
    await chmod(configPath, secureMode);
    const written = await readFile(configPath, "utf8");
    verify(written);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // The temp file was already renamed or never created.
    }
    if (existed && backupPath) {
      await copyFile(backupPath, configPath);
      await chmod(configPath, previousMode);
    } else {
      try {
        await unlink(configPath);
      } catch {
        // No created file remains.
      }
    }
    throw error;
  }
  return { changed: true, created: !existed, backupPath };
}

export async function configureAdapter(adapter, { token }) {
  const before = await inspectAdapter(adapter);
  if (!token) {
    throw new SetupError(
      "A Yandex KIT token is required on stdin.",
      "TOKEN_REQUIRED",
    );
  }
  const oldContent = before.configExists
    ? await readFile(adapter.configPath, "utf8")
    : "";
  const newContent = mergeContent(
    oldContent,
    adapter.format,
    token,
    adapter.configPath,
    adapter.serverName,
  );
  const write = await transactionalWrite(
    adapter.configPath,
    newContent,
    (written) => {
      const verified = inspectContent(
        written,
        adapter.format,
        adapter.configPath,
        adapter.serverName,
      );
      if (!verified.canonical || verified.token !== token) {
        throw new SetupError(
          `Verification failed for ${adapter.configPath}.`,
          "WRITE_VERIFICATION",
        );
      }
    },
  );
  return {
    client: adapter.client,
    format: adapter.format,
    configPath: adapter.configPath,
    serverName: adapter.serverName,
    configured: true,
    tokenPresent: true,
    changed: write.changed,
    created: write.created,
    backupPath: write.backupPath,
    backupHash: write.backupPath ? contentHash(oldContent) : null,
    configHash: contentHash(newContent),
  };
}

export async function rollbackChange({
  configPath,
  backupPath,
  backupHash,
  created,
  expectedHash,
}) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash || "")) {
    throw new SetupError(
      "Rollback requires the configHash reported by this setup run.",
      "INVALID_ROLLBACK",
    );
  }
  if (!(await fileExists(configPath))) {
    throw new SetupError(
      `Config changed after setup; nothing was removed at ${configPath}.`,
      "ROLLBACK_CONFLICT",
    );
  }
  const current = await readFile(configPath, "utf8");
  if (contentHash(current) !== expectedHash) {
    throw new SetupError(
      `Config changed after setup; rollback was refused for ${configPath}.`,
      "ROLLBACK_CONFLICT",
    );
  }
  const expectedBackup = `${configPath}${BACKUP_SUFFIX}`;
  if (created) {
    await unlink(configPath);
    return { rolledBack: true, removedCreatedConfig: true, configPath };
  }
  if (
    !backupPath ||
    path.resolve(backupPath) !== path.resolve(expectedBackup) ||
    !/^[a-f0-9]{64}$/.test(backupHash || "")
  ) {
    throw new SetupError(
      "Rollback backup and backupHash must match this setup run.",
      "INVALID_ROLLBACK",
    );
  }
  if (!(await fileExists(backupPath))) {
    throw new SetupError(`Backup not found at ${backupPath}.`, "BACKUP_NOT_FOUND");
  }
  const backup = await readFile(backupPath, "utf8");
  if (contentHash(backup) !== backupHash) {
    throw new SetupError(
      `Backup changed after setup; rollback was refused for ${configPath}.`,
      "ROLLBACK_CONFLICT",
    );
  }
  await copyFile(backupPath, configPath);
  await chmod(configPath, 0o600);
  return { rolledBack: true, removedCreatedConfig: false, configPath };
}

function sanitize(text, secret) {
  if (!secret) return String(text);
  return String(text).split(secret).join("[redacted]");
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

function spawnCaptured(
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
            sanitize(`Could not run ${command}: ${error.message}`, secret),
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
        stdout: sanitize(stdout, secret),
        stderr: sanitize(stderr, secret),
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
    const diagnostic = sanitize(
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

function clientCheckDefinition(client, serverName) {
  const checks = {
    "claude-code": {
      command: "claude",
      args: ["mcp", "get", serverName],
      optional: false,
    },
    cursor: {
      command: "cursor-agent",
      args: ["mcp", "list"],
      optional: true,
    },
    codex: {
      command: "codex",
      args: ["mcp", "list", "--json"],
      optional: false,
    },
    kimi: {
      command: "kimi",
      args: ["mcp", "test", serverName],
      optional: true,
      targeted: true,
    },
    openclaw: {
      command: "openclaw",
      args: ["mcp", "doctor", serverName, "--probe"],
      optional: false,
      targeted: true,
    },
  };
  return checks[client];
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
  const check = clientCheckDefinition(adapter.client, serverName);
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
    env:
      adapter.client === "codex"
        ? { ...process.env, CODEX_HOME: path.dirname(adapter.configPath) }
        : adapter.client === "kimi"
          ? { ...process.env, KIMI_CODE_HOME: path.dirname(adapter.configPath) }
        : process.env,
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

function extractStore(toolResult, secret) {
  if (toolResult?.isError) {
    const failureText = toolResult.content
      ?.filter((item) => item?.type === "text")
      .map((item) => item.text)
      .join(" ");
    throw new SetupError(
      sanitize(`get_store failed: ${failureText || "unknown MCP error"}`, secret),
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

export async function smokeMcp({
  token,
  command = SERVER_COMMAND,
  args = SERVER_ARGS,
  timeoutMs = 60_000,
}) {
  if (!token) {
    throw new SetupError("A stored Yandex KIT token is required.", "TOKEN_REQUIRED");
  }

  const invocation = buildSpawnInvocation(command, args, {
    windowsShim: command === SERVER_COMMAND,
  });
  const child = spawn(invocation.command, invocation.args, {
    env: { ...process.env, [TOKEN_KEY]: token },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 1;
  let stdoutBuffer = "";
  let stderr = "";
  const pending = new Map();

  const failPending = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

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
      clearTimeout(request.timer);
      if (message.error) {
        request.reject(
          new SetupError(
            sanitize(
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
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new SetupError(`MCP ${method} timed out.`, "SMOKE_TIMEOUT"));
      }, timeoutMs);
      timer.unref();
      pending.set(id, { resolve, reject, timer, method });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  const notify = (method, params = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  const startError = new Promise((_, reject) => {
    child.once("error", (error) => {
      reject(
        new SetupError(
          sanitize(`Could not start ${command}: ${error.message}`, token),
          "SMOKE_START",
        ),
      );
    });
    child.once("close", (code) => {
      if (pending.size > 0) {
        reject(
          new SetupError(
            sanitize(
              `MCP server exited with code ${code}: ${stderr.trim().slice(-500)}`,
              token,
            ),
            "SMOKE_EXIT",
          ),
        );
      }
    });
  });

  try {
    const operation = (async () => {
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
    return await Promise.race([operation, startError]);
  } finally {
    failPending(new SetupError("MCP smoke test closed.", "SMOKE_CLOSED"));
    child.stdin.end();
    child.kill("SIGTERM");
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
