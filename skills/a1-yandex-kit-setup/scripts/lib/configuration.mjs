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
import path from "node:path";
import { inspectConfig, mergeConfig } from "./config/index.mjs";
import { hasJsonServer, parseJsonConfig } from "./config/json.mjs";
import {
  BACKUP_SUFFIX,
  FALLBACK_SERVER_NAME,
  SERVER_NAME,
  SetupError,
} from "./shared.mjs";

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

export async function inspectAdapter(adapter) {
  const exists = await fileExists(adapter.configPath);
  const content = exists ? await readFile(adapter.configPath, "utf8") : "";
  const state = inspectConfig(
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
    const content = await readFile(configPath, "utf8");
    return hasJsonServer(content, format, configPath, serverName);
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
  const newContent = mergeConfig(
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
      const verified = inspectConfig(
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
