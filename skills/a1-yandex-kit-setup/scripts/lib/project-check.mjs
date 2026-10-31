import { SetupError } from './shared.mjs';
import { spawnCaptured } from './process.mjs';
import { isKitEntry, projectEntry } from './project-config.mjs';
import { inspectProject, projectStorage } from './project-setup.mjs';
function conflict(message = 'An effective legacy KIT server remains enabled. Disable it for this project with /mcp → Disable, then repeat client-check.') {
    return new SetupError(message, 'PLUGIN_CONFLICT');
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const stringMap = value => value == null || record(value) && Object.values(value).every(item => typeof item === 'string');
function httpUrl(value) {
    try { return typeof value === 'string' && ['https:', 'http:'].includes(new URL(value).protocol); }
    catch { return false; }
}
function parseCodexEntry(item) {
    if (!record(item) || typeof item.name !== 'string' || !item.name.trim() || /\s/.test(item.name) || typeof item.enabled !== 'boolean' || !record(item.transport))
        throw conflict('Codex returned an incomplete MCP inventory record. Inspect /mcp and the client version before retrying.');
    const transport = item.transport;
    const stdio = transport.type === 'stdio' || transport.type === undefined;
    const allowed = new Set(stdio ? ['type', 'command', 'args', 'env', 'env_vars', 'cwd'] : ['type', 'url', 'bearer_token_env_var', 'http_headers', 'env_http_headers', 'http_headers_helper']);
    if (Object.keys(transport).some(key => !allowed.has(key)))
        throw conflict('Codex returned an unsupported MCP transport schema. Inspect /mcp and the client version before retrying.');
    if (stdio) {
        if (typeof transport.command !== 'string' || !transport.command.trim() || !strings(transport.args) || !stringMap(transport.env) || transport.env_vars != null && !strings(transport.env_vars) || transport.cwd != null && typeof transport.cwd !== 'string')
            throw conflict('Codex did not establish a complete stdio MCP definition. Inspect /mcp before continuing.');
    } else if (transport.type !== 'streamable_http' || !httpUrl(transport.url) || !stringMap(transport.http_headers) || !stringMap(transport.env_http_headers) || transport.bearer_token_env_var != null && typeof transport.bearer_token_env_var !== 'string' || transport.http_headers_helper != null) {
        throw conflict('Codex returned an unsupported remote MCP definition. Inspect /mcp before continuing.');
    }
    const pluginId = item.plugin_id ?? item.pluginId;
    const serverKey = item.server_name ?? item.serverKey;
    const kind = pluginId || item.name.startsWith('plugin:') ? 'plugin' : 'server';
    if (kind === 'plugin' && isKitEntry(transport) && (typeof pluginId !== 'string' || !pluginId || typeof serverKey !== 'string' || !serverKey))
        throw conflict('Codex did not establish the actual KIT plugin identity. Disable its MCP entry for this project in /mcp before retrying.');
    return {name: item.name, entry: transport, kind, pluginId, serverKey, enabled: item.enabled};
}
function uniqueNames(entries) {
    if (new Set(entries.map(entry => entry.name)).size !== entries.length)
        throw conflict('The effective MCP inventory contains duplicate names. Resolve them in /mcp before retrying.');
    return entries;
}
export async function discoverEffectiveEntries(adapter, { run = spawnCaptured } = {}) {
    const command = adapter.client === 'codex' ? 'codex' : 'claude';
    const result = await run(command, ['mcp', 'list', ...(adapter.client === 'codex' ? ['--json'] : [])], {cwd: adapter.projectDir, env: adapter.env, timeoutMs: 60000});
    if (!result.available)
        throw new SetupError(`${command} is required to check effective project MCP entries. Install or enable the client and retry.`, 'CLIENT_COMMAND_MISSING');
    if (result.code !== 0)
        throw conflict('Could not inspect effective MCP entries. Run the client from this trusted project, inspect /mcp and retry.');
    if (adapter.client === 'codex') {
        let entries;
        try { entries = JSON.parse(result.stdout); }
        catch { throw conflict('Codex MCP inventory could not be interpreted; inspect /mcp before continuing.'); }
        if (!Array.isArray(entries) || result.stderr?.trim())
            throw conflict('Codex returned an unsupported or incomplete MCP inventory. Inspect /mcp before continuing.');
        return uniqueNames(entries.map(parseCodexEntry));
    }
    // Claude has no JSON mode. Preserve every supported entry, including the
    // managed identity, so a complete inventory can be checked against mcp get.
    const entries = [];
    let empty = false;
    const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
        if (line === 'Checking MCP server health...') continue;
        if (/^No MCP servers configured\.(?: Use `claude mcp add` to add a server\.)?$/.test(line)) {
            if (empty || entries.length) throw conflict('Claude returned a conflicting MCP inventory; inspect /mcp and retry.');
            empty = true;
            continue;
        }
        const match = line.match(/^(\S+):\s+(.+?)\s+-\s+(✓ Connected|✗ Failed to connect|⚠ Needs authentication|Disabled)$/u);
        if (!match || empty)
            throw conflict('Claude MCP inventory output is unsupported or incomplete. Inspect /mcp and disable legacy KIT entries for this project, then retry.');
        const [,name,definition,status] = match;
        const remote = definition.match(/^(https?:\/\/\S+)\s+\((HTTP|SSE)\)$/);
        let entry;
        if (remote) {
            if (!httpUrl(remote[1])) throw conflict('Claude returned an unsupported remote MCP definition. Inspect /mcp before continuing.');
            entry = {url: remote[1], type: remote[2].toLowerCase()};
        } else {
            if (/^https?:\/\//.test(definition))
                throw conflict('Claude returned an unestablished MCP transport. Inspect /mcp before continuing.');
            const args = definition.split(/\s+/);
            entry = {command: args.shift(), args};
            if (definition.includes('mcp-yandex-kit') && !isKitEntry(entry))
                throw conflict('Claude did not establish the identity of a possible legacy KIT entry. Inspect /mcp before continuing.');
        }
        entries.push({name, entry, definition, status, kind: name.startsWith('plugin:') ? 'plugin' : 'server', enabled: status !== 'Disabled'});
    }
    if (!empty && !entries.length)
        throw conflict('Claude did not return a complete MCP inventory. Inspect /mcp and retry.');
    return uniqueNames(entries);
}
function matchesManaged(entry, desired) {
    return entry.command === desired.command && JSON.stringify(entry.args) === JSON.stringify(desired.args) && entry.env?.YANDEX_KIT_CONNECTIONS_DIR === desired.env.YANDEX_KIT_CONNECTIONS_DIR && !entry.env?.YANDEX_KIT_TOKEN && !entry.env?.YANDEX_KIT_BASE_URL;
}
export async function checkProjectClient(adapter, { run = spawnCaptured } = {}) {
    const state = await inspectProject(adapter);
    if (!state.canonical)
        throw new SetupError('Project binding or managed MCP configuration is missing or inconsistent.', 'CLIENT_CHECK');
    const { root } = await projectStorage(adapter);
    const desired = projectEntry(adapter, root);
    const codex = adapter.client === 'codex';
    const command = codex ? 'codex' : 'claude';
    const args = ['mcp', 'get', adapter.serverName, ...(codex ? ['--json'] : [])];
    const result = await run(command, args, {cwd: adapter.projectDir, env: adapter.env, timeoutMs: 60000});
    if (!result.available)
        throw new SetupError(`${command} is unavailable for the effective project check.`, 'CLIENT_COMMAND_MISSING');
    if (result.code !== 0)
        throw new SetupError('The client did not load the project MCP configuration. Trust this project, restart the client, and retry.', 'CLIENT_CHECK');
    if (codex) {
        let effective;
        try { effective = parseCodexEntry(JSON.parse(result.stdout)); }
        catch { throw new SetupError('Codex returned an unsupported or inconsistent managed MCP definition.', 'SERVER_SHADOWED'); }
        if (effective.name !== adapter.serverName || !effective.enabled || !matchesManaged(effective.entry, desired))
            throw new SetupError('The effective project MCP definition differs from this binding. Check project trust and config precedence.', 'SERVER_SHADOWED');
    } else {
        const output = `${result.stdout}\n${result.stderr}`;
        const commandValue = output.match(/^\s*Command:\s*(.+?)\s*$/mi)?.[1];
        const argsValue = output.match(/^\s*Args:\s*(.+?)\s*$/mi)?.[1];
        const environment = output.match(/^\s*YANDEX_KIT_CONNECTIONS_DIR[=:]\s*(.+?)\s*$/mi)?.[1];
        if (commandValue !== desired.command || argsValue !== desired.args.join(' ') || environment !== root || /Scope:\s*(?:User|Project)/i.test(output) || /Status:\s*(?:disabled|failed)/i.test(output))
            throw new SetupError('Claude did not confirm the local project binding and private storage root. Inspect /mcp and the effective entry, then retry.', 'SERVER_SHADOWED');
    }
    const inventory = await discoverEffectiveEntries(adapter, {run});
    const managed = inventory.find(entry => entry.name === adapter.serverName);
    if (!managed || !managed.enabled || (codex ? !matchesManaged(managed.entry, desired) : managed.definition !== [desired.command, ...desired.args].join(' ') || managed.status !== '✓ Connected'))
        throw conflict('The complete effective MCP inventory omits or contradicts the managed project definition. Inspect /mcp, project trust and config precedence before retrying.');
    if (inventory.some(entry => entry.name !== adapter.serverName && isKitEntry(entry.entry) && entry.enabled))
        throw conflict();
    return {ok: true, mode: 'native', scope: 'project', client: adapter.client, serverName: adapter.serverName, projectDir: adapter.projectDir, restartRequired: true};
}
