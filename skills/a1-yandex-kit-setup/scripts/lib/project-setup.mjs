import { randomUUID } from 'node:crypto';
import { mkdir, chmod, realpath, access, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createConnectionStore, resolveConnectionsRoot } from './connections.mjs';
import { SetupError, redactSecret } from './shared.mjs';
import { readSnapshot, replaceSnapshot, withFileLocks, hash } from './project-files.mjs';
import { projectInventory, prepareProjectConfig, readProjectEntry, projectEntry } from './project-config.mjs';
function within(parent, child) { const r = path.relative(parent, child); return r === '' || (!r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r)); }
async function canonical(file) {
    try {
        return await realpath(file);
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
        const parent = path.dirname(file);
        if (parent === file)
            throw e;
        return path.join(await canonical(parent), path.basename(file));
    }
}
export async function projectStorage(adapter) {
    const root = resolveConnectionsRoot({ storageRoot: adapter.storageRoot, env: adapter.env });
    const resolved = await canonical(root);
    const project = await canonical(adapter.projectDir);
    if (within(project, resolved))
        throw new SetupError('The private connections directory must be outside the project repository.', 'UNSAFE_CONNECTIONS_ROOT');
    for (let dir = project;; dir = path.dirname(dir)) {
        try {
            await access(path.join(dir, '.git'));
            if (within(dir, resolved))
                throw new SetupError('The private connections directory must be outside the project repository.', 'UNSAFE_CONNECTIONS_ROOT');
            break;
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
        }
        if (path.dirname(dir) === dir)
            break;
    }
    return { root, storage: createConnectionStore({ storageRoot: root, env: adapter.env }) };
}
export async function loadProject(adapter) {
    const { root, storage } = await projectStorage(adapter);
    const binding = await storage.readBinding(adapter.bindingPath);
    const connection = await storage.readConnection(binding.value.connection_id);
    return { root, storage, binding, connection };
}
export async function inspectProject(adapter) {
    const entry = await readProjectEntry(adapter);
    let loaded;
    try {
        loaded = await loadProject(adapter);
    }
    catch (e) {
        if (e.code !== 'missing_binding')
            throw e;
    }
    const desired = loaded && projectEntry(adapter, loaded.root);
    const canonical = Boolean(desired && entry && entry.enabled !== false && entry.command === desired.command && JSON.stringify(entry.args) === JSON.stringify(desired.args) && entry.env?.YANDEX_KIT_CONNECTIONS_DIR === loaded.root && !entry.env?.YANDEX_KIT_TOKEN && !entry.env?.YANDEX_KIT_BASE_URL);
    return { client: adapter.client, scope: 'project', configPath: adapter.configPath, projectDir: adapter.projectDir, bindingPath: adapter.bindingPath, serverName: adapter.serverName, entryPresent: Boolean(entry), configured: canonical, canonical, tokenPresent: Boolean(loaded), connectionId: loaded?.binding.value.connection_id ?? null, store: loaded ? { id: loaded.connection.value.store_id, name: loaded.connection.value.store_name ?? null, url: loaded.connection.value.store_url ?? null } : null, sharedBinding: Boolean(loaded), restartRequired: true };
}
export async function validateProjectToken(adapter, token, { validateToken } = {}) {
    let result;
    try {
        const env = { ...adapter.env };
        delete env.YANDEX_KIT_BASE_URL;
        delete env.YANDEX_KIT_TOKEN;
        result = await (validateToken || ((value) => (import('./smoke.mjs')).then(m => m.smokeMcp({ token: value, env }))))(token);
    }
    catch (e) {
        throw new SetupError(redactSecret(e instanceof Error ? e.message : 'Token validation failed.', token), e.code || 'SMOKE_RESULT');
    }
    const s = result?.store;
    if (!result?.ok || !s || !['string', 'number'].includes(typeof s.id) || !String(s.id).trim())
        throw new SetupError('Read-only token validation did not return a store identity.', 'SMOKE_RESULT');
    let before;
    try {
        before = await loadProject(adapter);
    }
    catch (e) {
        if (e.code !== 'missing_binding')
            throw e;
    }
    return { result, store: { version: 1, token, store_id: String(s.id), ...(s.name || s.slug ? { store_name: String(s.name || s.slug) } : {}), ...(s.url ? { store_url: String(s.url) } : {}) }, before };
}
export async function smokeProject(adapter, overrides = {}) {
    const { root, connection } = await loadProject(adapter);
    const env = { ...adapter.env, YANDEX_KIT_CONNECTIONS_DIR: root };
    delete env.YANDEX_KIT_TOKEN;
    delete env.YANDEX_KIT_BASE_URL;
    const { smokeMcp } = await import('./smoke.mjs');
    return smokeMcp({ ...overrides, token: undefined, projectConfig: adapter.bindingPath, expectedStoreId: connection.value.store_id, env });
}
function copyRecord(v) { return { ...v, token: v.token }; }
async function undo(actions, storage) {
    for (const a of [...actions].reverse()) {
        if (a.kind === 'file')
            await replaceSnapshot(a.path, a.before.revision === null ? null : a.before.content, a.after);
        else if (a.kind === 'binding') {
            if (a.before)
                await storage.writeBinding(a.path, a.before.value, { expectedRevision: a.after });
            else
                await storage.removeBinding(a.path, { expectedRevision: a.after });
        }
        else if (a.before)
            await storage.writeConnection(a.id, a.before.value, { expectedRevision: a.after });
        else
            await storage.removeConnection(a.id, { expectedRevision: a.after });
    }
}
export async function configureProject(adapter, options = {}) {
    const { root, storage } = await projectStorage(adapter);
    return storage.withProjectLock(adapter.bindingPath, async () => {
        let binding, connection;
        try {
            binding = await storage.readBinding(adapter.bindingPath);
            connection = await storage.readConnection(binding.value.connection_id);
        }
        catch (e) {
            if (e.code !== 'missing_binding')
                throw e;
        }
        const discover = options.discover || (async (a) => (await import('./project-check.mjs')).discoverEffectiveEntries(a));
        const inventory = await projectInventory(adapter, { discover });
        let token = options.token;
        if (!token && !binding) {
            const candidates = [];
            for (const e of inventory.entries)
                if (typeof e.entry.env?.YANDEX_KIT_TOKEN === 'string' && e.entry.env.YANDEX_KIT_TOKEN.trim()) {
                    const known = candidates.find(c => c.token === e.entry.env.YANDEX_KIT_TOKEN);
                    if (known) {
                        known.names.push(e.name);
                        continue;
                    }
                    const validated = await validateProjectToken(adapter, e.entry.env.YANDEX_KIT_TOKEN, options);
                    candidates.push({ token: e.entry.env.YANDEX_KIT_TOKEN, store: validated.store, names: [e.name] });
                }
            const selected = options.migrateServer ? candidates.find(c => c.names.includes(options.migrateServer)) : undefined;
            if (options.migrateServer && !selected)
                throw new SetupError('The selected legacy server was not found with a verifiable token.', 'MIGRATION_SELECTION');
            if (!selected && new Set(candidates.map(c => c.store.store_id)).size > 1)
                throw new SetupError(`Several stores are configured. Select one with --migrate-server: ${candidates.flatMap(c => c.names.map(n => `${n} (${c.store.store_name || c.store.store_id})`)).join(', ')}.`, 'MIGRATION_SELECTION');
            token = selected?.token || candidates[0]?.token;
        }
        if (options.changeStore && !token)
            throw new SetupError('Changing a project store requires a new validated token.', 'TOKEN_REQUIRED');
        if (!binding && !token)
            throw new SetupError('A Yandex KIT token is required for this project.', 'TOKEN_REQUIRED');
        const validated = token ? await validateProjectToken(adapter, token, options) : undefined;
        if (binding && validated && !options.changeStore && validated.store.store_id !== connection.value.store_id)
            throw new SetupError('The replacement token belongs to another store. Use the explicit change-store action to change this project.', 'STORE_MISMATCH');
        const updates = await prepareProjectConfig(adapter, root, inventory);
        const actions = [];
        let id = binding?.value.connection_id;
        return withFileLocks([...updates.keys()], async () => {
            // Observe all source files, including read-only global policy, before publishing.
            for (const [file, snapshot] of inventory.snapshots)
                if ((await readSnapshot(file)).revision !== snapshot.revision)
                    throw new SetupError('Configuration changed while preparing setup. Retry after inspecting concurrent edits.', 'CONFIG_CONFLICT');
            let transactionId;
            try {
                if (validated) {
                    const create = !binding || options.changeStore;
                    if (create)
                        id = randomUUID();
                    const previous = create ? null : { value: copyRecord(connection.value), revision: connection.revision };
                    if (create || JSON.stringify(copyRecord(connection.value)) !== JSON.stringify(validated.store)) {
                        const written = await storage.writeConnection(id, validated.store, { expectedRevision: previous?.revision ?? null });
                        actions.push({ kind: 'connection', id, before: previous, after: written.revision });
                    }
                    if (create) {
                        const written = await storage.writeBinding(adapter.bindingPath, { version: 1, connection_id: id }, { expectedRevision: binding?.revision ?? null });
                        actions.push({ kind: 'binding', path: adapter.bindingPath, before: binding || null, after: written.revision });
                    }
                }
                for (const [file, content] of updates) {
                    const before = inventory.snapshots.get(file);
                    if (before.content === content)
                        continue;
                    const after = await replaceSnapshot(file, content, before.revision);
                    actions.push({ kind: 'file', path: file, before, after });
                }
                const runtime = await (options.verifyRuntime || smokeProject)(adapter);
                const client = await (options.verifyClient || (async (a) => (await import('./project-check.mjs')).checkProjectClient(a)))(adapter);
                if (!runtime?.ok || !client?.ok)
                    throw new SetupError('Project verification did not establish readiness.', 'CLIENT_CHECK');
                for (const [file, content] of updates)
                    if ((await readSnapshot(file)).revision !== hash(content))
                        throw new SetupError('Configuration changed during verification.', 'CONFIG_CONFLICT');
                const finalBinding = await storage.readBinding(adapter.bindingPath);
                const expectedBinding = actions.find(a => a.kind === 'binding')?.after ?? binding?.revision;
                if (finalBinding.revision !== expectedBinding || finalBinding.value.connection_id !== id)
                    throw new SetupError('Project binding changed during verification.', 'CONFIG_CONFLICT');
                const finalConnection = await storage.readConnection(id);
                const expectedConnection = actions.find(a => a.kind === 'connection')?.after ?? connection?.revision;
                if (finalConnection.revision !== expectedConnection)
                    throw new SetupError('Project credentials changed during verification.', 'CONFIG_CONFLICT');
                if (actions.length) {
                    transactionId = randomUUID();
                    const dir = path.join(root, '.setup-transactions');
                    await mkdir(dir, { recursive: true, mode: 0o700 });
                    await assertPrivate(dir, true);
                    await chmod(dir, 0o700);
                    const guards = [];
                    for (const file of updates.keys())
                        guards.push({ path: file, revision: (await readSnapshot(file)).revision });
                    await replaceSnapshot(path.join(dir, `${transactionId}.json`), JSON.stringify({ version: 1, bindingPath: adapter.bindingPath, configPath: adapter.configPath, client: adapter.client, actions, guards }), null);
                }
                return { ...await inspectProject(adapter), changed: actions.length > 0, transactionId: transactionId || null, verified: true, restartRequired: true, message: 'Restart all existing chats for this project to load this connection.' };
            }
            catch (e) {
                try {
                    await undo(actions, storage);
                }
                catch {
                    throw new SetupError('Setup failed and rollback found a concurrent edit. Changes were preserved; inspect the project configuration and private connection before retrying.', 'ROLLBACK_CONFLICT');
                }
                throw new SetupError(redactSecret(e instanceof Error ? e.message : 'Project setup failed.', token), e.code || 'PROJECT_SETUP');
            }
        });
    });
}
export async function rollbackProject(adapter, transactionId) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(transactionId || ''))
        throw new SetupError('Project rollback requires the transactionId reported by setup.', 'INVALID_ROLLBACK');
    const { root, storage } = await projectStorage(adapter);
    return storage.withProjectLock(adapter.bindingPath, async () => {
        const journalPath = path.join(root, '.setup-transactions', `${transactionId}.json`);
        await assertPrivate(path.dirname(journalPath), true);
        await assertPrivate(journalPath, false);
        const snapshot = await readSnapshot(journalPath);
        // The private journal can contain previous configuration secrets. Its directory
        // inherits the protected Windows root ACL; POSIX ownership/mode is checked above.
        let journal;
        try { journal = JSON.parse(snapshot.content); }
        catch { throw new SetupError("The private rollback journal is invalid; inspect it locally before retrying.", "INVALID_ROLLBACK"); }
        if (journal.version !== 1 || journal.bindingPath !== adapter.bindingPath || journal.configPath !== adapter.configPath || journal.client !== adapter.client || !Array.isArray(journal.actions))
            throw new SetupError('Rollback transaction belongs to another project or client.', 'INVALID_ROLLBACK');
        return withFileLocks([...(journal.guards || []).map(g => g.path), ...journal.actions.filter(a => a.kind === 'file').map(a => a.path)], async () => {
            for (const guard of journal.guards || [])
                if ((await readSnapshot(guard.path)).revision !== guard.revision)
                    throw new SetupError('Project configuration changed after setup; rollback refused.', 'ROLLBACK_CONFLICT');
            for (const a of journal.actions) {
                const current = a.kind === 'file' ? await readSnapshot(a.path) : a.kind === 'binding' ? await storage.readBinding(a.path) : await storage.readConnection(a.id);
                if (current.revision !== a.after)
                    throw new SetupError('Project state changed after setup; rollback refused.', 'ROLLBACK_CONFLICT');
            }
            await undo(journal.actions, storage);
            await replaceSnapshot(journalPath, null, snapshot.revision);
            return { rolledBack: true, scope: 'project', restartRequired: true };
        });
    });
}
export async function projectTokenCallbacks(adapter, options = {}) {
    return {
        validateToken: async (token) => {
            const v = await validateProjectToken(adapter, token, options);
            if (v.before && !options.changeStore && v.store.store_id !== v.before.connection.value.store_id)
                throw new SetupError('The replacement token belongs to a different store. Use change-store explicitly.', 'STORE_MISMATCH');
            return v.result;
        },
        persistToken: token => configureProject(adapter, { ...options, token }),
    };
}
async function assertPrivate(file, directory) {
    const st = await lstat(file);
    if (st.isSymbolicLink() || !(directory ? st.isDirectory() : st.isFile()) || (process.platform !== "win32" && ((st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid()))))
        throw new SetupError('The private rollback journal must be owned by this user and inaccessible to other users.', 'UNSAFE_STORAGE');
}
