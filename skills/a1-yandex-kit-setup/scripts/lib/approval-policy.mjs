import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseJsonConfig } from "./config/json.mjs";
import {
  inspectCodexApprovalPolicy,
  inspectKimiApprovalPolicy,
  mergeCodexApprovalPolicy,
  mergeKimiApprovalPolicy,
} from "./config/toml.mjs";
import { contentHash, transactionalWrite } from "./configuration.mjs";
import {
  FALLBACK_SERVER_NAME,
  SERVER_NAME,
  SetupError,
  normalizeServerName,
} from "./shared.mjs";

export const IMPORT_PROFILE_VERSION = 2;
// Kept as a public machine contract: "*" means every current and future tool
// exposed by the managed Yandex KIT MCP server.
export const IMPORT_TOOL_NAMES = Object.freeze(["*"]);

const POLICY_CAPABILITIES = Object.freeze({
  "claude-code": {
    support: "automatic",
    scope: "server",
    enforcement: "host",
    configSource: "documented-file",
    requiresRestart: true,
  },
  codex: {
    support: "automatic",
    scope: "server",
    enforcement: "host",
    configSource: "documented-file",
    requiresRestart: true,
  },
  kimi: {
    support: "automatic",
    scope: "server",
    enforcement: "host",
    configSource: "documented-file",
    requiresRestart: true,
  },
  cursor: {
    support: "automatic",
    scope: "server",
    enforcement: "host",
    configSource: "local-version-gated",
    requiresRestart: true,
  },
  vscode: {
    support: "guided",
    scope: "tool",
    enforcement: "host",
    configSource: "documented-ui",
    requiresRestart: false,
    nextAction: "OPEN_TOOL_APPROVAL_UI",
  },
  "claude-desktop": {
    support: "guided",
    scope: "tool",
    enforcement: "host",
    configSource: "documented-ui",
    requiresRestart: true,
    nextAction: "ALLOW_EACH_IMPORT_TOOL_IN_UI",
  },
  "kimi-desktop": {
    support: "unsupported",
    scope: "task",
    enforcement: "host",
    configSource: "none",
    requiresRestart: false,
    nextAction: "KEEP_PROMPTS",
  },
  hermes: {
    support: "unsupported",
    scope: "none",
    enforcement: "none",
    configSource: "none",
    requiresRestart: false,
    nextAction: "KEEP_PROMPTS",
  },
  openclaw: {
    support: "unsupported",
    scope: "none",
    enforcement: "none",
    configSource: "none",
    requiresRestart: false,
    nextAction: "KEEP_PROMPTS",
  },
});

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readConfig(configPath) {
  return (await fileExists(configPath)) ? readFile(configPath, "utf8") : "";
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

export function defaultApprovalConfigPath(
  client,
  { platform = process.platform, home = os.homedir(), env = process.env } = {},
) {
  if (client === "claude-code") {
    return path.join(home, ".claude", "settings.json");
  }
  if (client === "codex") {
    return path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml");
  }
  if (client === "kimi") {
    return path.join(env.KIMI_CODE_HOME || path.join(home, ".kimi-code"), "config.toml");
  }
  if (client === "cursor") {
    return path.join(home, ".cursor", "permissions.json");
  }
  return null;
}

export function defaultCursorSchemaPath(
  { platform = process.platform, env = process.env } = {},
) {
  if (env.CURSOR_PERMISSIONS_SCHEMA) return env.CURSOR_PERMISSIONS_SCHEMA;
  if (platform === "darwin") {
    return "/Applications/Cursor.app/Contents/Resources/app/extensions/cursor-always-local/schemas/permissions.schema.json";
  }
  return null;
}

export function approvalCapability(client) {
  const capability = POLICY_CAPABILITIES[client];
  if (!capability) {
    return {
      support: "unsupported",
      scope: "none",
      enforcement: "none",
      configSource: "none",
      requiresRestart: false,
      nextAction: "KEEP_PROMPTS",
    };
  }
  return { ...capability };
}

function baseResult(client) {
  return {
    client,
    profile: "yandex-kit-server-wildcard",
    profileVersion: IMPORT_PROFILE_VERSION,
    tools: [...IMPORT_TOOL_NAMES],
    includesFutureTools: true,
    ...approvalCapability(client),
  };
}

function ensureStringArray(value, field, configPath) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new SetupError(
      `Expected ${field} to be an array of strings in ${configPath}.`,
      "MALFORMED_CONFIG",
    );
  }
  return value;
}

function globMatches(pattern, value) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function claudeWildcard(serverName) {
  return `mcp__${serverName}__*`;
}

function cursorWildcards(effectiveServerId) {
  if (!effectiveServerId) return [];
  const unscoped = effectiveServerId.startsWith("user-")
    ? effectiveServerId.slice("user-".length)
    : effectiveServerId;
  return [...new Set([`${unscoped}:*`, `user-${unscoped}:*`])];
}

function claudeRuleTargetsManagedServer(rule, serverName) {
  return rule.startsWith(`mcp__${serverName}__`);
}

function claudeRuleMayOverrideServer(rule, serverName) {
  if (claudeRuleTargetsManagedServer(rule, serverName)) return true;
  return ["get_store", "kit_request", "future_yandex_kit_tool"].some((tool) =>
    globMatches(rule, `mcp__${serverName}__${tool}`),
  );
}

function inspectClaude(content, configPath, serverName) {
  const config = parseJsonConfig(content, configPath);
  const permissions = config.permissions ?? {};
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    throw new SetupError(
      `Expected permissions to be an object in ${configPath}.`,
      "MALFORMED_CONFIG",
    );
  }
  const allow = ensureStringArray(permissions.allow, "permissions.allow", configPath);
  const ask = ensureStringArray(permissions.ask, "permissions.ask", configPath);
  const deny = ensureStringArray(permissions.deny, "permissions.deny", configPath);
  const expected = [claudeWildcard(serverName)];
  const conflictingRules = [...deny, ...ask].filter((rule) =>
    claudeRuleMayOverrideServer(rule, serverName),
  );
  const managedConflicts = conflictingRules.filter((rule) =>
    claudeRuleTargetsManagedServer(rule, serverName),
  );
  const externalConflicts = conflictingRules.filter(
    (rule) => !managedConflicts.includes(rule),
  );
  const missingRules = expected.filter((rule) => !allow.includes(rule));
  return {
    config,
    allow,
    ask,
    deny,
    expected,
    conflictingRules,
    managedConflicts,
    externalConflicts,
    missingRules,
    configured:
      conflictingRules.length === 0 &&
      missingRules.length === 0,
  };
}

function inspectCursor(content, configPath, effectiveServerId) {
  const config = parseJsonConfig(content, configPath);
  const allowlist = ensureStringArray(config.mcpAllowlist, "mcpAllowlist", configPath);
  const expected = cursorWildcards(effectiveServerId);
  const missingRules = expected.filter((rule) => !allowlist.includes(rule));
  return {
    config,
    allowlist,
    expected,
    missingRules,
    configured:
      Boolean(effectiveServerId) &&
      missingRules.length === 0,
  };
}

async function cursorSchemaSupported(schemaPath) {
  if (!schemaPath || !(await fileExists(schemaPath))) return false;
  try {
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const property = schema?.properties?.mcpAllowlist;
    return property?.type === "array" && property?.items?.type === "string";
  } catch {
    return false;
  }
}

function statusReason({ configured, conflictingRules = [], verified = true }) {
  if (!verified) return "POLICY_UNVERIFIED";
  if (conflictingRules.length > 0) return "POLICY_CONFLICT";
  return configured ? "POLICY_APPLIED" : "POLICY_NOT_CONFIGURED";
}

export async function inspectApprovalPolicy({
  client,
  configPath = defaultApprovalConfigPath(client),
  serverName = SERVER_NAME,
  effectiveServerId,
  cursorSchemaPath = defaultCursorSchemaPath(),
} = {}) {
  const capability = baseResult(client);
  if (capability.support !== "automatic") {
    return {
      ...capability,
      configured: false,
      verified: false,
      reasonCode:
        capability.support === "guided"
          ? "POLICY_USER_STEP"
          : "POLICY_CLIENT_UNSUPPORTED",
    };
  }
  if (!configPath) {
    return {
      ...capability,
      configured: false,
      verified: false,
      reasonCode: "POLICY_UNVERIFIED",
    };
  }
  const normalizedServer = normalizeServerName(serverName);
  const content = await readConfig(configPath);
  if (client === "cursor") {
    const schemaVerified = await cursorSchemaSupported(cursorSchemaPath);
    const state = inspectCursor(content, configPath, effectiveServerId);
    return {
      ...capability,
      configPath,
      cursorSchemaPath,
      effectiveServerId: effectiveServerId ?? null,
      configured: state.configured && schemaVerified,
      structuralVerified: state.configured && schemaVerified,
      verified: false,
      wildcardRules: state.expected,
      missingRules: state.missingRules,
      reasonCode: statusReason({
        ...state,
        configured: state.configured && schemaVerified,
        verified: schemaVerified && Boolean(effectiveServerId),
      }),
      nextAction: "RELOAD_AND_VERIFY_BEHAVIOR",
    };
  }
  if (client === "claude-code") {
    const state = inspectClaude(content, configPath, normalizedServer);
    return {
      ...capability,
      configPath,
      configured: state.configured,
      structuralVerified: state.configured,
      verified: false,
      wildcardRules: state.expected,
      conflictingRules: state.conflictingRules,
      missingRules: state.missingRules,
      reasonCode: statusReason(state),
      nextAction: "START_NEW_SESSION_AND_VERIFY_BEHAVIOR",
    };
  }
  const state = client === "codex"
    ? inspectCodexApprovalPolicy(content, configPath, normalizedServer)
    : inspectKimiApprovalPolicy(content, configPath, normalizedServer);
  return {
    ...capability,
    configPath,
    configured: state.configured,
    structuralVerified: state.configured,
    verified: false,
    wildcardRules: state.wildcardRules,
    conflictingRules: state.conflictingRules,
    missingRules: state.missingRules,
    reasonCode: statusReason(state),
    nextAction: "START_NEW_SESSION_AND_VERIFY_BEHAVIOR",
  };
}

export async function configureApprovalPolicy({
  client,
  configPath = defaultApprovalConfigPath(client),
  serverName = SERVER_NAME,
  effectiveServerId,
  cursorSchemaPath = defaultCursorSchemaPath(),
} = {}) {
  const before = await inspectApprovalPolicy({
    client,
    configPath,
    serverName,
    effectiveServerId,
    cursorSchemaPath,
  });
  if (before.support !== "automatic") return before;
  if (before.reasonCode === "POLICY_UNVERIFIED") return before;
  if (before.structuralVerified) {
    return {
      ...before,
      changed: false,
      created: false,
      backupPath: null,
      backupHash: null,
    };
  }

  const normalizedServer = normalizeServerName(serverName);
  const oldContent = await readConfig(configPath);
  let newContent;
  if (client === "claude-code") {
    const state = inspectClaude(oldContent, configPath, normalizedServer);
    if (state.externalConflicts.length > 0) return before;
    const config = state.config;
    const permissions = config.permissions ?? {};
    permissions.allow = [
      ...state.allow.filter(
        (rule) => !claudeRuleTargetsManagedServer(rule, normalizedServer),
      ),
      ...state.expected,
    ];
    permissions.ask = state.ask.filter(
      (rule) => !state.managedConflicts.includes(rule),
    );
    permissions.deny = state.deny.filter(
      (rule) => !state.managedConflicts.includes(rule),
    );
    config.permissions = permissions;
    newContent = `${JSON.stringify(config, null, 2)}\n`;
  } else if (client === "cursor") {
    if (!effectiveServerId) return before;
    const state = inspectCursor(oldContent, configPath, effectiveServerId);
    const config = state.config;
    const managedIds = state.expected.map((rule) => rule.slice(0, -1));
    const preserved = state.allowlist.filter(
      (rule) => !managedIds.some((prefix) => rule.startsWith(prefix)),
    );
    config.mcpAllowlist = [...new Set([...preserved, ...state.expected])];
    newContent = `${JSON.stringify(config, null, 2)}\n`;
  } else if (client === "codex") {
    newContent = mergeCodexApprovalPolicy(
      oldContent,
      configPath,
      normalizedServer,
    );
  } else {
    newContent = mergeKimiApprovalPolicy(
      oldContent,
      configPath,
      normalizedServer,
    );
  }

  const write = await transactionalWrite(configPath, newContent, () => {});
  const after = await inspectApprovalPolicy({
    client,
    configPath,
    serverName: normalizedServer,
    effectiveServerId,
    cursorSchemaPath,
  });
  if (!after.structuralVerified) {
    throw new SetupError(
      `Approval policy verification failed for ${configPath}.`,
      "WRITE_VERIFICATION",
    );
  }
  return {
    ...after,
    changed: write.changed,
    created: write.created,
    backupPath: write.backupPath,
    backupHash: write.backupPath ? contentHash(oldContent) : null,
    configHash: contentHash(newContent),
  };
}
