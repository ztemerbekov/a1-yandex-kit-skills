import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { SetupError, SERVER_COMMAND, SERVER_ARGS } from './shared.mjs';
import { parseJsonConfig } from './config/json.mjs';
import { validateTomlSubset, renderToml, parseTomlString, parseTomlArgs, tomlAssignment, splitTomlAssignment, parseTomlDottedKey } from './config/toml.mjs';
import { readSnapshot, canonicalPath, assertProjectConfigScope } from './project-files.mjs';
export const PROJECT_SERVER = 'a1-yandex-kit-project';
const object = v => v && typeof v === 'object' && !Array.isArray(v);
function expectObject(v) { if (!object(v))
    throw new SetupError('Unsupported configuration structure; inspect it before retrying.', 'MALFORMED_CONFIG'); return v; }
export function isKitEntry(entry) {
    if (!object(entry) || typeof entry.command !== 'string' || !Array.isArray(entry.args))
        return false;
    const command = path.basename(entry.command).replace(/\.cmd$/, '');
    return (['npx', 'npm', 'pnpm', 'bunx', 'bun', 'yarn'].includes(command) && entry.args.some(arg => typeof arg === 'string' && /^(?:@a1\/)?mcp-yandex-kit(?:@[^\s]+)?$/.test(arg))) || command === 'mcp-yandex-kit';
}
export function projectEntry(adapter, root) { return { command: SERVER_COMMAND, args: [...SERVER_ARGS, '--project-config', adapter.bindingPath], env: { YANDEX_KIT_CONNECTIONS_DIR: root } }; }
function value(raw) {
    if (raw === undefined)
        return undefined;
    const parsed = parseTomlString(raw);
    if (parsed !== undefined)
        return parsed;
    if (raw.trim() === 'true')
        return true;
    if (raw.trim() === 'false')
        return false;
    return parseTomlArgs(raw);
}
function tableEntries(content, file) {
    const chunks = validateTomlSubset(content, file), entries = [];
    for (const chunk of chunks) {
        const keys = chunk.header ? parseTomlDottedKey(chunk.header.match(/^\s*\[(.+?)\]/)?.[1] || '') : [];
        if (keys?.length !== 2 || keys[0] !== 'mcp_servers')
            continue;
        const entry = {};
        for (const line of chunk.body) {
            const a = splitTomlAssignment(line);
            if (a?.keyParts.length === 1)
                entry[a.keyParts[0]] = value(a.value);
        }
        const env = chunks.find(c => c.name === `${chunk.name}.env`);
        entry.env = {};
        for (const line of env?.body || []) {
            const a = splitTomlAssignment(line);
            if (a?.keyParts.length === 1)
                entry.env[a.keyParts[0]] = value(a.value);
        }
        entries.push({ name: keys[1], entry, chunks, prefix: chunk.name });
    }
    return entries;
}
function setTable(chunks, name, assignments) {
    const normalized = parseTomlDottedKey(name)?.join(".");
    let t = chunks.find(c => c.name === normalized);
    if (!t) {
        t = { name: normalized, header: `[${name}]`, array: false, body: [] };
        chunks.push(t);
    }
    const keys = new Set(Object.keys(assignments));
    t.body = t.body.filter(line => !keys.has(splitTomlAssignment(line)?.keyParts.join('.')));
    t.body.push(...Object.entries(assignments).map(([k, v]) => `${k} = ${JSON.stringify(v)}`));
}
function addRule(target, rule, decision) {
    for (const d of ['allow', 'ask', 'deny'])
        if (d !== decision && target[d]?.includes(rule))
            throw new SetupError('Conflicting targeted permission rules require manual resolution.', 'POLICY_CONFLICT');
    target[decision] ??= [];
    if (!target[decision].includes(rule))
        target[decision].push(rule);
}
export function migrateClaudeRules(config, names) {
    const permissions = config.permissions;
    if (permissions === undefined)
        return config;
    expectObject(permissions);
    for (const decision of ['allow', 'ask', 'deny']) {
        if (permissions[decision] === undefined)
            continue;
        if (!Array.isArray(permissions[decision]) || permissions[decision].some(r => typeof r !== 'string'))
            throw new SetupError('Unsupported permission rules require manual migration.', 'POLICY_CONFLICT');
        for (const rule of [...permissions[decision]])
            for (const name of names) {
                const prefix = `mcp__${name}`;
                if (rule === prefix || rule.startsWith(`${prefix}__`))
                    addRule(permissions, `mcp__${PROJECT_SERVER}${rule.slice(prefix.length)}`, decision);
                else if (rule.includes(name))
                    throw new SetupError('Ambiguous permission rule requires manual migration.', 'POLICY_CONFLICT');
            }
    }
    return config;
}
async function codexConfigHierarchy(adapter) {
    const ancestors = [];
    for (let directory = path.dirname(await canonicalPath(adapter.projectDir));; directory = path.dirname(directory)) {
        ancestors.push(path.join(directory, '.codex', 'config.toml'));
        if (path.dirname(directory) === directory) break;
    }
    return [...new Set([adapter.userConfigPath, ...ancestors.reverse(), adapter.configPath])];
}
export async function projectInventory(adapter, { discover = async () => [] } = {}) {
    await assertProjectConfigScope(adapter);
    const snapshots = new Map();
    const read = async (file) => {
        if (!snapshots.has(file)) snapshots.set(file, await readSnapshot(file));
        return snapshots.get(file).content;
    };
    const definitions = [];
    const configFiles = adapter.client === 'codex' ? await codexConfigHierarchy(adapter) : [adapter.configPath];
    if (adapter.client === 'codex') {
        for (const file of configFiles)
            for (const found of tableEntries(await read(file), file))
                definitions.push({ ...found, file, kind: 'server' });
    } else {
        const config = parseJsonConfig(await read(adapter.configPath), adapter.configPath);
        const local = config.projects?.[adapter.projectDir];
        for (const [name, entry] of Object.entries(config.mcpServers || {}))
            definitions.push({ name, entry, file: adapter.configPath, kind: 'server', scope: 'user' });
        const projectMcp = path.join(adapter.projectDir, '.mcp.json');
        const project = parseJsonConfig(await read(projectMcp), projectMcp);
        for (const [name, entry] of Object.entries(project.mcpServers || {}))
            definitions.push({ name, entry, file: projectMcp, kind: 'server', scope: 'project' });
        for (const [name, entry] of Object.entries(local?.mcpServers || {}))
            definitions.push({ name, entry, file: adapter.configPath, kind: 'server', scope: 'local' });
    }
    definitions.push(...await discover(adapter));
    const entries = definitions.filter(e => isKitEntry(e.entry) && e.name !== PROJECT_SERVER);
    const kitNames = new Set(entries.map(e => e.name));
    // A name-wide disable also affects higher-scope unrelated definitions. Refuse
    // ambiguous provenance instead of changing those definitions or permissions.
    for (const definition of definitions) {
        const entry = definition.entry;
        const suppliesTransport = object(entry) && ['command', 'args', 'url'].some(key => entry[key] !== undefined);
        if (kitNames.has(definition.name) && suppliesTransport && !isKitEntry(entry))
            throw new SetupError('A legacy KIT name is shadowed by another server or an unestablished transport override. Resolve that name in the client before migrating.', 'SERVER_CONFLICT');
    }
    return { entries, snapshots, read, configFiles };
}
function mergeCodexPolicy(chunks, sources) {
    const assignments = new Map();
    for (const source of sources)
        for (const chunk of source.chunks || []) {
            if (chunk.name !== source.prefix && !chunk.name?.startsWith(`${source.prefix}.tools.`))
                continue;
            const suffix = chunk.name.slice(source.prefix.length);
            const name = `mcp_servers.${PROJECT_SERVER}${suffix}`;
            for (const line of chunk.body) {
                const a = splitTomlAssignment(line);
                if (!a)
                    continue;
                const key = a.keyParts.join('.');
                if (!suffix && !['default_tools_approval_mode', 'enabled_tools', 'disabled_tools'].includes(key))
                    continue;
                if (suffix && key !== 'approval_mode')
                    throw new SetupError('Unsupported targeted tool policy requires manual migration.', 'POLICY_CONFLICT');
                const k = `${name}:${key}`, v = a.value.trim();
                if (assignments.has(k) && assignments.get(k) !== v)
                    throw new SetupError('Different legacy servers have conflicting tool policies.', 'POLICY_CONFLICT');
                assignments.set(k, v);
                let t = chunks.find(c => c.name === name);
                if (!t) {
                    t = { name, header: `[${name}]`, array: false, body: [] };
                    chunks.push(t);
                }
                const existing = t.body.find(l => splitTomlAssignment(l)?.keyParts.join('.') === key);
                if (existing && splitTomlAssignment(existing).value.trim() !== v)
                    throw new SetupError('Project and legacy tool policies conflict.', 'POLICY_CONFLICT');
                if (!existing)
                    t.body.push(`${key} = ${v}`);
            }
        }
}
export async function prepareProjectConfig(adapter, root, inventory) {
    const { entries, read } = inventory;
    const updates = new Map();
    const desired = projectEntry(adapter, root);
    await checkManagedPolicy(adapter, inventory);
    if (adapter.client === 'codex') {
        const chunks = validateTomlSubset(await read(adapter.configPath), adapter.configPath);
        const existing = tableEntries(await read(adapter.configPath), adapter.configPath).find(e => e.name === PROJECT_SERVER);
        if (existing && !isKitEntry(existing.entry))
            throw new SetupError('An unrelated server occupies the project server name.', 'SERVER_CONFLICT');
        // Replace only our transport/env; keep targeted tool policy and unrelated tables.
        const prefix = `mcp_servers.${PROJECT_SERVER}`;
        for (let i = chunks.length - 1; i >= 0; i--)
            if (chunks[i].name === `${prefix}.env`)
                chunks.splice(i, 1);
        setTable(chunks, prefix, { command: desired.command, args: desired.args, enabled: true });
        setTable(chunks, `${prefix}.env`, desired.env);
        const policySources = [...entries];
        // Policy-only ancestors inherit transport from another layer. Include all
        // layers for each established KIT identity, even without command/args.
        for (const name of new Set(entries.filter(e => e.kind !== 'plugin').map(e => e.name)))
            for (const file of inventory.configFiles)
                policySources.push({chunks: validateTomlSubset(await read(file), file), prefix: `mcp_servers.${name}`});
        for (const e of entries.filter(e => e.kind === "plugin" && e.pluginId && e.serverKey))
            for (const file of inventory.configFiles) {
                policySources.push({ ...e, chunks: validateTomlSubset(await read(file), file), prefix: `plugins.${e.pluginId}.mcp_servers.${e.serverKey}` });
            }
        mergeCodexPolicy(chunks, policySources);
        for (const e of entries) {
            if (e.kind === 'plugin') {
                if (typeof e.pluginId !== 'string' || !e.pluginId || typeof e.serverKey !== 'string' || !e.serverKey)
                    throw new SetupError('Cannot establish plugin identity. Disable its KIT MCP server for this project in /mcp and retry.', 'PLUGIN_CONFLICT');
                setTable(chunks, `plugins.${JSON.stringify(e.pluginId)}.mcp_servers.${JSON.stringify(e.serverKey)}`, { enabled: false });
            }
            else {
                setTable(chunks, `mcp_servers.${JSON.stringify(e.name)}`, { enabled: false });
                if (e.file === adapter.configPath) {
                    const env = chunks.find(c => c.name === `mcp_servers.${e.name}.env`);
                    if (env)
                        env.body = env.body.filter(line => splitTomlAssignment(line)?.keyParts.join('.') !== 'YANDEX_KIT_TOKEN');
                }
            }
        }
        updates.set(adapter.configPath, renderToml(chunks));
    }
    else {
        const config = parseJsonConfig(await read(adapter.configPath), adapter.configPath);
        config.projects ??= {};
        expectObject(config.projects);
        config.projects[adapter.projectDir] ??= {};
        const p = expectObject(config.projects[adapter.projectDir]);
        p.mcpServers ??= {};
        expectObject(p.mcpServers);
        if (p.mcpServers[PROJECT_SERVER] && !isKitEntry(p.mcpServers[PROJECT_SERVER]))
            throw new SetupError('An unrelated server occupies the project server name.', 'SERVER_CONFLICT');
        p.mcpServers[PROJECT_SERVER] = { type: 'stdio', ...desired };
        p.disabledMcpServers ??= [];
        if (!Array.isArray(p.disabledMcpServers) || p.disabledMcpServers.some(n => typeof n !== 'string'))
            throw new SetupError('Use /mcp → Disable for the legacy KIT servers, then retry.', 'PLUGIN_CONFLICT');
        p.disabledMcpServers = p.disabledMcpServers.filter(n => n !== PROJECT_SERVER);
        for (const e of entries)
            if (!p.disabledMcpServers.includes(e.name))
                p.disabledMcpServers.push(e.name);
        updates.set(adapter.configPath, `${JSON.stringify(config, null, 2)}\n`);
        // Global rules are preserved; their targeted equivalents live only in this project.
        const settings = path.join(adapter.projectDir, '.claude', 'settings.local.json');
        const local = parseJsonConfig(await read(settings), settings);
        for (const file of [path.join(adapter.home, '.claude', 'settings.json'), path.join(adapter.home, '.claude', 'settings.local.json'), path.join(adapter.projectDir, '.claude', 'settings.json')]) {
            const global = parseJsonConfig(await read(file), file);
            if (global.permissions) {
                expectObject(global.permissions);
                for (const d of ['allow', 'ask', 'deny'])
                    if (global.permissions[d] !== undefined && (!Array.isArray(global.permissions[d]) || global.permissions[d].some(r => typeof r !== "string")))
                        throw new SetupError('Unsupported permission rules require manual migration.', 'POLICY_CONFLICT');
            }
            for (const d of ['allow', 'ask', 'deny'])
                for (const rule of global.permissions?.[d] || []) {
                    if (entries.some(e => rule === `mcp__${e.name}` || rule.startsWith(`mcp__${e.name}__`))) {
                        local.permissions ??= {};
                        addRule(local.permissions, rule, d);
                    }
                }
        }
        migrateClaudeRules(local, entries.map(e => e.name));
        if (local.permissions)
            updates.set(settings, `${JSON.stringify(local, null, 2)}\n`);
    }
    return updates;
}
export async function readProjectEntry(adapter) {
    await assertProjectConfigScope(adapter);
    const s = await readSnapshot(adapter.configPath);
    if (adapter.client === 'codex')
        return tableEntries(s.content, adapter.configPath).find(e => e.name === PROJECT_SERVER)?.entry;
    return parseJsonConfig(s.content, adapter.configPath).projects?.[adapter.projectDir]?.mcpServers?.[PROJECT_SERVER];
}
async function checkManagedPolicy(adapter, inventory) {
    const platform = process.platform;
    let files;
    if (adapter.client === 'codex') {
        files = [path.join(path.dirname(adapter.userConfigPath), 'managed_config.toml')];
        if (platform === 'win32')
            files.push(path.join(adapter.env.ProgramData || 'C:\\ProgramData', 'OpenAI', 'Codex', 'requirements.toml'));
        else
            files.push('/etc/codex/requirements.toml', '/etc/codex/managed_config.toml');
    }
    else {
        const dir = platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : platform === 'win32' ? path.join(adapter.env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode') : '/etc/claude-code';
        files = [path.join(dir, 'managed-settings.json'), path.join(dir, 'managed-mcp.json')];
        try {
            for (const name of await readdir(path.join(dir, 'managed-settings.d')))
                if (name.endsWith('.json'))
                    files.push(path.join(dir, 'managed-settings.d', name));
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw new SetupError('Managed settings cannot be inspected. Ask your administrator to confirm the project server policy.', 'POLICY_CONFLICT');
        }
    }
    for (const file of [...new Set(files)]) {
        const content = await inventory.read(file);
        if (content.trim() && /mcp|permission|approval|allow|deny|ask/i.test(content))
            throw new SetupError('Managed MCP or permission policy is present. Ask your administrator to preserve its targeted rules for a1-yandex-kit-project before migrating. Setup does not change managed policy.', 'POLICY_CONFLICT');
    }
}
