import {
  SERVER_ARGS,
  SERVER_COMMAND,
  SERVER_NAME,
  TOKEN_KEY,
  SetupError,
  configStatus,
  stripCommentOutsideQuotes,
} from "../shared.mjs";

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
  if (!server) return configStatus({ entryPresent: false });
  const command = parseTomlString(tomlAssignment(server.body, "command") || "");
  const args = parseTomlArgs(tomlAssignment(server.body, "args"));
  const token = env
    ? parseTomlString(tomlAssignment(env.body, TOKEN_KEY) || "")
    : undefined;
  return configStatus({
    entryPresent: true,
    command,
    args,
    token,
  });
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

function setTomlStringAssignment(body, key, value, configPath) {
  return [
    `${key} = ${tomlString(value)}`,
    ...removeTomlAssignments(body, new Set([key]), configPath),
  ];
}

function approvalMode(chunk) {
  return parseTomlString(tomlAssignment(chunk.body, "approval_mode") || "");
}

export function inspectCodexApprovalPolicy(
  content,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const chunks = validateTomlSubset(content, configPath);
  const serverTable = `mcp_servers.${serverName}`;
  const server = uniqueTomlChunk(chunks, serverTable, configPath);
  const defaultMode = server
    ? parseTomlString(
        tomlAssignment(server.body, "default_tools_approval_mode") || "",
      )
    : undefined;
  const prefix = `${serverTable}.tools.`;
  const toolModes = new Map();
  for (const chunk of chunks) {
    if (!chunk.array && chunk.name?.startsWith(prefix)) {
      toolModes.set(chunk.name.slice(prefix.length), approvalMode(chunk));
    }
  }
  const conflictingRules = [...toolModes]
    .filter(([, mode]) => mode !== undefined && mode !== "approve")
    .map(([tool]) => tool);
  const missingRules = defaultMode === "approve"
    ? []
    : ["default_tools_approval_mode"];
  return {
    entryPresent: Boolean(server),
    configured:
      Boolean(server) &&
      missingRules.length === 0 &&
      conflictingRules.length === 0,
    defaultMode,
    wildcardRules: defaultMode === "approve"
      ? ["default_tools_approval_mode=approve"]
      : [],
    missingRules,
    conflictingRules,
  };
}

export function mergeCodexApprovalPolicy(
  content,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const before = inspectCodexApprovalPolicy(
    content,
    configPath,
    serverName,
  );
  if (!before.entryPresent) {
    throw new SetupError(
      `The managed MCP server is missing from ${configPath}.`,
      "POLICY_SERVER_MISSING",
    );
  }

  const chunks = validateTomlSubset(content, configPath);
  const serverTable = `mcp_servers.${serverName}`;
  const server = uniqueTomlChunk(chunks, serverTable, configPath);
  server.body = setTomlStringAssignment(
    server.body,
    "default_tools_approval_mode",
    "approve",
    configPath,
  );
  const prefix = `${serverTable}.tools.`;

  for (const chunk of chunks) {
    if (!chunk.array && chunk.name?.startsWith(prefix)) {
      chunk.body = setTomlStringAssignment(
        chunk.body,
        "approval_mode",
        "approve",
        configPath,
      );
    }
  }
  return renderToml(chunks);
}

function globMatches(pattern, value) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") index += 1;
      source += ".*";
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`).test(value);
}

function kimiRule(chunk) {
  return {
    decision: parseTomlString(tomlAssignment(chunk.body, "decision") || ""),
    pattern: parseTomlString(tomlAssignment(chunk.body, "pattern") || ""),
  };
}

export function inspectKimiApprovalPolicy(
  content,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const chunks = validateTomlSubset(content, configPath);
  const rules = chunks
    .filter((chunk) => chunk.array && chunk.name === "permission.rules")
    .map((chunk) => ({ chunk, ...kimiRule(chunk) }));
  const wildcard = `mcp__${serverName}__*`;
  const wildcardIndex = rules.findIndex(
    (rule) => rule.decision === "allow" && rule.pattern === wildcard,
  );
  const samples = [
    `mcp__${serverName}__get_store`,
    `mcp__${serverName}__kit_request`,
    `mcp__${serverName}__future_yandex_kit_tool`,
  ];
  const preceding = wildcardIndex === -1 ? rules : rules.slice(0, wildcardIndex);
  const conflictingRules = preceding
    .filter(
      (rule) =>
        rule.decision !== "allow" &&
        rule.pattern &&
        (rule.pattern.startsWith(`mcp__${serverName}__`) ||
          samples.some((sample) => globMatches(rule.pattern, sample))),
    )
    .map((rule) => rule.pattern);
  return {
    configured:
      wildcardIndex !== -1 &&
      conflictingRules.length === 0,
    wildcardRules: wildcardIndex === -1 ? [] : [wildcard],
    missingRules: wildcardIndex === -1 ? [wildcard] : [],
    conflictingRules,
  };
}

function newKimiAllowRule(serverName) {
  return {
    header: "[[permission.rules]]",
    name: "permission.rules",
    array: true,
    body: [
      'decision = "allow"',
      `pattern = ${tomlString(`mcp__${serverName}__*`)}`,
      'reason = "Yandex KIT full server access"',
    ],
  };
}

export function mergeKimiApprovalPolicy(
  content,
  configPath = "<config>",
  serverName = SERVER_NAME,
) {
  const chunks = validateTomlSubset(content, configPath);
  const wildcard = `mcp__${serverName}__*`;
  let allowChunk = chunks.find(
    (chunk) =>
      chunk.array &&
      chunk.name === "permission.rules" &&
      kimiRule(chunk).decision === "allow" &&
      kimiRule(chunk).pattern === wildcard,
  );
  if (allowChunk) chunks.splice(chunks.indexOf(allowChunk), 1);
  else allowChunk = newKimiAllowRule(serverName);

  const insertion = chunks.findIndex(
    (chunk) => chunk.array && chunk.name === "permission.rules",
  );
  chunks.splice(insertion === -1 ? chunks.length : insertion, 0, allowChunk);
  return renderToml(chunks);
}
