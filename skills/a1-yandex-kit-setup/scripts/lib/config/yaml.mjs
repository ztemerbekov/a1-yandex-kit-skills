import {
  SERVER_ARGS,
  SERVER_COMMAND,
  SERVER_NAME,
  TOKEN_KEY,
  SetupError,
  configStatus,
  stripCommentOutsideQuotes,
} from "../shared.mjs";

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
    return configStatus({ entryPresent: false });
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
  return configStatus({
    entryPresent: true,
    command,
    args,
    token,
  });
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
