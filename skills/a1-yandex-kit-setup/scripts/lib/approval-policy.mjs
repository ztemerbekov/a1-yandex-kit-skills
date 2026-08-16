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

export const IMPORT_PROFILE_VERSION = 1;
export const IMPORT_TOOL_NAMES = Object.freeze([
  "get_store",
  "search_operations",
  "get_operation_schema",
  "upload_file",
  "get_file",
  "upload_video",
  "upload_video_from_url",
  "list_videos",
  "get_video",
  "list_products",
  "get_product",
  "create_product",
  "update_product",
  "list_variants",
  "get_variant",
  "create_variant",
  "update_variant",
  "bulk_update_prices",
  "list_categories",
  "get_category",
  "create_category",
  "update_category",
  "list_collections",
  "get_collection",
  "create_collection",
  "update_collection",
  "list_characteristic_colors",
  "list_characteristics",
  "get_characteristic",
  "create_characteristic",
  "update_characteristic",
  "list_characteristic_groups",
  "get_characteristic_group",
  "create_characteristic_group",
  "update_characteristic_group",
  "update_characteristic_color",
  "list_blogs",
  "get_blog",
  "create_blog",
  "update_blog",
]);

const POLICY_CAPABILITIES = Object.freeze({
  "claude-code": {
    support: "automatic",
    scope: "tool",
    enforcement: "host",
    configSource: "documented-file",
    requiresRestart: true,
  },
  codex: {
    support: "automatic",
    scope: "tool",
    enforcement: "host",
    configSource: "documented-file",
    requiresRestart: true,
  },
  kimi: {
    support: "automatic",
    scope: "tool",
    enforcement: "host",
    configSource: "documented-file",
    requiresRestart: true,
  },
  cursor: {
    support: "automatic",
    scope: "tool",
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
    profile: "unattended-import",
    profileVersion: IMPORT_PROFILE_VERSION,
    tools: [...IMPORT_TOOL_NAMES],
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

function managedServerNames(serverName) {
  return new Set([serverName, SERVER_NAME, FALLBACK_SERVER_NAME]);
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
  const expected = IMPORT_TOOL_NAMES.map((tool) => `mcp__${serverName}__${tool}`);
  const broadRules = allow.filter((rule) =>
    [...managedServerNames(serverName)].some(
      (name) => rule === `mcp__${name}__*`,
    ),
  );
  const conflictingTools = expected.filter((rule) =>
    [...deny, ...ask].some((pattern) => globMatches(pattern, rule)),
  );
  const missingRules = expected.filter((rule) => !allow.includes(rule));
  return {
    config,
    allow,
    ask,
    deny,
    expected,
    broadRules,
    conflictingTools,
    missingRules,
    configured:
      broadRules.length === 0 &&
      conflictingTools.length === 0 &&
      missingRules.length === 0,
  };
}

function inspectCursor(content, configPath, effectiveServerId) {
  const config = parseJsonConfig(content, configPath);
  const allowlist = ensureStringArray(config.mcpAllowlist, "mcpAllowlist", configPath);
  const knownIds = new Set([
    effectiveServerId,
    SERVER_NAME,
    FALLBACK_SERVER_NAME,
    `user-${SERVER_NAME}`,
    `user-${FALLBACK_SERVER_NAME}`,
  ].filter(Boolean));
  const broadRules = allowlist.filter((rule) =>
    [...knownIds].some((id) => rule === `${id}:*`),
  );
  const expected = effectiveServerId
    ? IMPORT_TOOL_NAMES.map((tool) => `${effectiveServerId}:${tool}`)
    : [];
  const missingRules = expected.filter((rule) => !allowlist.includes(rule));
  return {
    config,
    allowlist,
    expected,
    broadRules,
    missingRules,
    configured:
      Boolean(effectiveServerId) &&
      broadRules.length === 0 &&
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

function statusReason({ configured, broadRules = [], conflictingTools = [], verified = true }) {
  if (!verified) return "POLICY_UNVERIFIED";
  if (broadRules.length > 0) return "POLICY_TOO_BROAD";
  if (conflictingTools.length > 0) return "POLICY_CONFLICT";
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
      broadRules: state.broadRules,
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
      broadRules: state.broadRules,
      conflictingTools: state.conflictingTools,
      missingRules: state.missingRules,
      reasonCode: statusReason(state),
      nextAction: "START_NEW_SESSION_AND_VERIFY_BEHAVIOR",
    };
  }
  const state = client === "codex"
    ? inspectCodexApprovalPolicy(content, IMPORT_TOOL_NAMES, configPath, normalizedServer)
    : inspectKimiApprovalPolicy(content, IMPORT_TOOL_NAMES, configPath, normalizedServer);
  const broadRules = state.broadDefault
    ? ["default_tools_approval_mode", ...state.broadRules]
    : state.broadRules;
  return {
    ...capability,
    configPath,
    configured: state.configured,
    structuralVerified: state.configured,
    verified: false,
    broadRules,
    conflictingTools: state.conflictingTools,
    missingRules: state.missingTools,
    reasonCode: statusReason({ ...state, broadRules }),
    nextAction: "START_NEW_SESSION_AND_VERIFY_BEHAVIOR",
  };
}

export async function configureApprovalPolicy({
  client,
  configPath = defaultApprovalConfigPath(client),
  serverName = SERVER_NAME,
  effectiveServerId,
  cursorSchemaPath = defaultCursorSchemaPath(),
  replaceBroad = false,
  replaceConflicts = false,
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
  if (before.broadRules?.length > 0 && !replaceBroad) return before;
  if (before.conflictingTools?.length > 0 && !replaceConflicts) return before;

  const normalizedServer = normalizeServerName(serverName);
  const oldContent = await readConfig(configPath);
  let newContent;
  if (client === "claude-code") {
    const state = inspectClaude(oldContent, configPath, normalizedServer);
    const config = state.config;
    const permissions = config.permissions ?? {};
    const removed = replaceBroad
      ? state.allow.filter((rule) => !state.broadRules.includes(rule))
      : state.allow;
    permissions.allow = [...new Set([...removed, ...state.expected])];
    config.permissions = permissions;
    newContent = `${JSON.stringify(config, null, 2)}\n`;
  } else if (client === "cursor") {
    if (!effectiveServerId) return before;
    const state = inspectCursor(oldContent, configPath, effectiveServerId);
    const config = state.config;
    const removed = replaceBroad
      ? state.allowlist.filter((rule) => !state.broadRules.includes(rule))
      : state.allowlist;
    config.mcpAllowlist = [...new Set([...removed, ...state.expected])];
    newContent = `${JSON.stringify(config, null, 2)}\n`;
  } else if (client === "codex") {
    newContent = mergeCodexApprovalPolicy(
      oldContent,
      IMPORT_TOOL_NAMES,
      configPath,
      normalizedServer,
      { replaceBroad, replaceConflicts },
    );
  } else {
    newContent = mergeKimiApprovalPolicy(
      oldContent,
      IMPORT_TOOL_NAMES,
      configPath,
      normalizedServer,
      { replaceBroad, replaceConflicts },
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
