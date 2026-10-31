/** Canonical dependency-free storage; setup receives an identical generated copy. */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { execFileSync } from "node:child_process";

/** @typedef {{version: 1, connection_id: string}} ProjectBinding */
/** @typedef {{version: 1, token: string, store_id: string, store_name?: string, store_url?: string}} Connection */
/** @typedef {{storageRoot?: string, env?: Record<string, string | undefined>}} StorageOptions */
/** @typedef {{expectedRevision: string | null}} WriteOptions */
/** @template T @typedef {{readonly value: Readonly<T>, readonly revision: string}} Snapshot */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ConnectionStorageError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "ConnectionStorageError";
    this.code = code;
  }
}

/** @param {unknown} err @param {string} code */
function hasCode(err, code) {
  return !!err && typeof err === "object" && "code" in err && err.code === code;
}

/** OS/JSON errors may contain paths or file contents. @param {unknown} err */
function storageError(err) {
  return err instanceof ConnectionStorageError ? err : new ConnectionStorageError("storage_error", "Cannot access project connection storage.");
}

/** @param {unknown} path */
function absolutePath(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    throw new ConnectionStorageError("invalid_path", "Connection storage requires an explicit absolute path.");
  }
  return path;
}

/** Explicit test/remote override: YANDEX_KIT_CONNECTIONS_DIR; never changes HOME. @param {StorageOptions} [options] */
export function resolveConnectionsRoot({ storageRoot, env = process.env } = {}) {
  return absolutePath(storageRoot ?? env.YANDEX_KIT_CONNECTIONS_DIR ?? join(homedir(), ".a1-yandex-kit", "connections"));
}

/** @param {unknown} value */
function connectionId(value) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new ConnectionStorageError("invalid_connection_id", "Connection ID must be a canonical UUID.");
  }
  return value.toLowerCase();
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectionStorageError("invalid_record", "Invalid connection record.");
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @returns {ProjectBinding} */
function bindingValue(value) {
  const entry = object(value);
  if (entry.version !== 1 || Object.keys(entry).some((key) => !["version", "connection_id"].includes(key))) throw new ConnectionStorageError("invalid_binding", "Invalid or unsupported project binding.");
  return Object.freeze({ version: 1, connection_id: connectionId(entry.connection_id) });
}

/** @param {unknown} value @returns {Connection} */
function connectionValue(value) {
  const entry = object(value);
  if (entry.version !== 1 || typeof entry.token !== "string" || !entry.token.trim() || typeof entry.store_id !== "string" || !entry.store_id.trim() || Object.keys(entry).some((key) => !["version", "token", "store_id", "store_name", "store_url"].includes(key))) throw new ConnectionStorageError("invalid_connection", "Invalid or unsupported private connection.");
  /** @type {Connection} */
  const result = { version: 1, token: entry.token, store_id: entry.store_id };
  for (const key of /** @type {const} */ (["store_name", "store_url"])) {
    if (entry[key] === undefined) continue;
    if (typeof entry[key] !== "string" || !entry[key].trim()) throw new ConnectionStorageError("invalid_connection", "Invalid store display metadata.");
    result[key] = entry[key];
  }
  if (result.store_url) {
    try {
      const url = new URL(result.store_url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { throw new ConnectionStorageError("invalid_connection", "Invalid store display URL."); }
  }
  // A caller must explicitly access token; JSON/public status cannot leak it.
  Object.defineProperty(result, "token", { enumerable: false });
  return Object.freeze(result);
}

/** @param {string} text */
function revision(text) { return createHash("sha256").update(text).digest("hex"); }

/**
 * Establish an exact Windows DACL for the current SID, failing closed on error. New
 * private files are empty until this succeeds. No shell interpolation is used.
 * @param {string} path @param {boolean} directory
 */
function windowsPrivate(path, directory) {
  if (process.platform !== "win32") return;
  try {
    const output = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const sid = output.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if (!sid) throw new Error();
    // A fresh protected DACL replaces earlier explicit/inherited grants in one
    // Set-Acl operation. Never use icacls /reset: it can expose an existing
    // secret by temporarily restoring permissive inherited access.
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$sid = [System.Security.Principal.SecurityIdentifier]::new($env:A1_KIT_ACL_SID)",
      directory
        ? "$acl = [System.Security.AccessControl.DirectorySecurity]::new(); $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')"
        : "$acl = [System.Security.AccessControl.FileSecurity]::new(); $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow')",
      "$acl.SetOwner($sid)",
      "$acl.SetAccessRuleProtection($true, $false)",
      "$acl.AddAccessRule($rule)",
      "Set-Acl -LiteralPath $env:A1_KIT_ACL_PATH -AclObject $acl",
    ].join("; ");
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true, stdio: "pipe", env: { ...process.env, A1_KIT_ACL_PATH: path, A1_KIT_ACL_SID: sid },
    });
    execFileSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:${directory ? "(OI)(CI)" : ""}F`], { windowsHide: true, stdio: "pipe" });
  } catch { throw new ConnectionStorageError("unsafe_storage", "Cannot establish current-user access to private connection storage."); }
}

/** @param {import('node:fs').Stats} info @param {boolean} directory @param {boolean} privateFile */
function checkInfo(info, directory, privateFile) {
  if ((directory ? !info.isDirectory() : !info.isFile()) || info.isSymbolicLink() || (privateFile && process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())))) throw new ConnectionStorageError("unsafe_storage", "Connection storage must be owned by the current user and private; symbolic links are not allowed.");
}

/** @param {string} path @param {boolean} privateDirectory @param {boolean} create */
async function directory(path, privateDirectory, create) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  checkInfo(await lstat(path), true, privateDirectory);
  if (privateDirectory) windowsPrivate(path, true);
}

/** @param {string} path @param {boolean} privateFile @returns {Promise<string | null>} */
async function contents(path, privateFile) {
  let handle;
  try {
    checkInfo(await lstat(path), false, privateFile);
    if (privateFile) windowsPrivate(path, false);
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    checkInfo(await handle.stat(), false, privateFile);
    return await handle.readFile("utf8");
  } catch (err) {
    if (hasCode(err, "ENOENT")) return null;
    throw storageError(err);
  } finally { await handle?.close(); }
}

/** @template T @param {string} path @param {() => Promise<T>} callback @returns {Promise<T>} */
async function locked(path, callback) {
  let handle;
  try { handle = await open(path, "wx", 0o600); }
  catch (err) {
    if (hasCode(err, "EEXIST")) throw new ConnectionStorageError("conflict", "Connection settings are being changed by another process. Retry after it finishes.");
    throw storageError(err);
  }
  try { return await callback(); }
  finally { await handle.close(); await unlink(path); }
}

/**
 * expectedRevision:null is create-only; a loaded revision enables compare-and-
 * swap. Lock contention fails explicitly; stale locks are never auto-deleted.
 * @param {StorageOptions} [options]
 */
export function createConnectionStore(options = {}) {
  const root = resolveConnectionsRoot(options);
  /** @param {string} id */
  const connectionPath = (id) => join(root, `${connectionId(id)}.json`);

  /** @template T @param {string} path @param {boolean} privateFile @param {(value: unknown) => T} validate @param {string} missing @returns {Promise<Snapshot<T>>} */
  async function read(path, privateFile, validate, missing) {
    try {
      absolutePath(path);
      if (privateFile) {
        try { await directory(root, true, false); }
        catch (err) { if (hasCode(err, "ENOENT")) throw new ConnectionStorageError(missing, "Private connection is missing. Run project setup again."); throw err; }
      }
      const text = await contents(path, privateFile);
      if (text === null) throw new ConnectionStorageError(missing, "Project binding or private connection is missing. Run project setup again.");
      return Object.freeze({ value: validate(JSON.parse(text)), revision: revision(text) });
    } catch (err) { throw storageError(err); }
  }

  /** @param {string} path @param {boolean} privateFile @param {unknown} value @param {WriteOptions} options @param {boolean} [remove] */
  async function mutate(path, privateFile, value, { expectedRevision }, remove = false) {
    try {
      absolutePath(path);
      if (expectedRevision !== null && (typeof expectedRevision !== "string" || !/^[0-9a-f]{64}$/.test(expectedRevision))) throw new ConnectionStorageError("conflict", "A valid expected revision is required.");
      if (remove && expectedRevision === null) throw new ConnectionStorageError("conflict", "Removal requires the revision created by this transaction.");
      await directory(privateFile ? root : dirname(path), privateFile, true);
      return await locked(`${path}.lock`, async () => {
        const old = await contents(path, privateFile);
        if ((old === null ? null : revision(old)) !== expectedRevision) throw new ConnectionStorageError("conflict", "Connection settings changed. Read them again before retrying.");
        if (remove) { await unlink(path); return Object.freeze({ revision: null }); }
        // The only boundary that intentionally serializes the non-enumerable token.
        const serialized = privateFile ? { ...object(value), token: /** @type {Connection} */ (value).token } : value;
        const text = `${JSON.stringify(serialized)}\n`;
        const temporary = `${path}.${randomUUID()}.tmp`;
        let handle;
        try {
          handle = await open(temporary, "wx", 0o600);
          if (privateFile) windowsPrivate(temporary, false);
          await handle.writeFile(text, "utf8");
          await handle.sync();
          await handle.close(); handle = undefined;
          await rename(temporary, path);
        } finally {
          await handle?.close();
          try { await unlink(temporary); } catch (err) { if (!hasCode(err, "ENOENT")) throw err; }
        }
        return Object.freeze({ revision: revision(text) });
      });
    } catch (err) { throw storageError(err); }
  }

  return Object.freeze({
    /** @param {string} path */
    readBinding: (path) => read(path, false, bindingValue, "missing_binding"),
    /** @param {string} path @param {ProjectBinding} value @param {WriteOptions} opts */
    writeBinding: async (path, value, opts) => mutate(path, false, bindingValue(value), opts),
    /** @param {string} id */
    readConnection: async (id) => read(connectionPath(id), true, connectionValue, "missing_connection"),
    /** @param {string} id @param {Connection} value @param {WriteOptions} opts */
    writeConnection: async (id, value, opts) => mutate(connectionPath(id), true, connectionValue(value), opts),
    /** @param {string} path @param {WriteOptions} opts */
    removeBinding: (path, opts) => mutate(path, false, null, opts, true),
    /** @param {string} id @param {WriteOptions} opts */
    removeConnection: async (id, opts) => mutate(connectionPath(id), true, null, opts, true),
    /** Separate transaction lock: CAS methods may run inside it. @template T @param {string} path @param {() => Promise<T>} callback */
    withProjectLock: async (path, callback) => {
      absolutePath(path);
      try { await directory(dirname(path), false, true); } catch (err) { throw storageError(err); }
      return locked(`${path}.setup.lock`, callback);
    },
  });
}
