import { SetupError } from './shared.mjs';
import { spawnCaptured } from './process.mjs';
import { isKitEntry, projectEntry } from './project-config.mjs';
import { inspectProject, projectStorage } from './project-setup.mjs';
function conflict(message = 'An effective legacy KIT server remains enabled. Disable it for this project with /mcp → Disable, then repeat client-check.') { return new SetupError(message, 'PLUGIN_CONFLICT'); }
export async function discoverEffectiveEntries(adapter, { run = spawnCaptured } = {}) {
    const command = adapter.client === 'codex' ? 'codex' : 'claude';
    const result = await run(command, ['mcp', 'list', ...(adapter.client === 'codex' ? ['--json'] : [])], { cwd: adapter.projectDir, env: adapter.env, timeoutMs: 60000 });
    if (!result.available)
        throw new SetupError(`${command} is required to check effective project MCP entries. Install or enable the client and retry.`, 'CLIENT_COMMAND_MISSING');
    if (result.code !== 0)
        throw conflict('Could not inspect effective MCP entries. Run the client from this trusted project, inspect /mcp and retry.');
    if (adapter.client === 'codex') {
        let entries;
        try {
            entries = JSON.parse(result.stdout);
        }
        catch {
            throw conflict('Codex MCP inventory could not be interpreted; inspect /mcp before continuing.');
        }
        if (!Array.isArray(entries))
            throw conflict('Codex returned an unsupported MCP inventory.');
        return entries.filter(e => e.name !== 'a1-yandex-kit-project').map(e => ({ name: e.name, entry: e.transport || e, kind: e.plugin_id || e.pluginId || e.name?.startsWith('plugin:') ? 'plugin' : 'server', pluginId: e.plugin_id || e.pluginId, serverKey: e.server_name || e.serverKey, enabled: e.enabled !== false })).filter(e => isKitEntry(e.entry));
    }
    // Claude has no JSON mode. A plugin's printed command must establish package
    // identity; do not guess a plugin identifier from its display name.
    const entries = [];
    for (const line of `${result.stdout}\n${result.stderr}`.split('\n')) {
        if (!line.includes('mcp-yandex-kit'))
            continue;
        const m = line.match(/^\s*([^\s]+):\s+(.*?)\s+(?:-|✓|✗|⚠)/u) || line.match(/^\s*([^\s]+):\s+(.*?)\s*$/u);
        if (!m)
            throw conflict();
        const name = m[1];
        if (name === 'a1-yandex-kit-project')
            continue;
        const args = m[2].split(/\s+/);
        const command = args.shift();
        const entry = { command, args };
        if (!isKitEntry(entry))
            throw conflict();
        entries.push({ name, entry, kind: name.startsWith('plugin:') ? 'plugin' : 'server', enabled: !/[Dd]isabled/.test(line) });
    }
    return entries;
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
    const result = await run(command, args, { cwd: adapter.projectDir, env: adapter.env, timeoutMs: 60000 });
    if (!result.available)
        throw new SetupError(`${command} is unavailable for the effective project check.`, 'CLIENT_COMMAND_MISSING');
    if (result.code !== 0)
        throw new SetupError('The client did not load the project MCP configuration. Trust this project, restart the client, and retry.', 'CLIENT_CHECK');
    if (codex) {
        let effective;
        try {
            effective = JSON.parse(result.stdout);
        }
        catch {
            throw new SetupError('Codex returned an unsupported MCP definition.', 'CLIENT_CHECK');
        }
        const t = effective.transport || effective;
        if (effective.enabled === false || t.command !== desired.command || JSON.stringify(t.args) !== JSON.stringify(desired.args) || t.env?.YANDEX_KIT_CONNECTIONS_DIR !== root || t.env?.YANDEX_KIT_TOKEN || t.env?.YANDEX_KIT_BASE_URL)
            throw new SetupError('The effective project MCP definition differs from this binding. Check project trust and config precedence.', 'SERVER_SHADOWED');
    }
    else {
        const output = `${result.stdout}\n${result.stderr}`;
        // Parse labelled fields; mere substring/name matches cannot establish identity.
        const commandValue = output.match(/^\s*Command:\s*(.+?)\s*$/mi)?.[1];
        const argsValue = output.match(/^\s*Args:\s*(.+?)\s*$/mi)?.[1];
        const environment = output.match(/^\s*YANDEX_KIT_CONNECTIONS_DIR[=:]\s*(.+?)\s*$/mi)?.[1];
        if (commandValue !== desired.command || argsValue !== desired.args.join(' ') || environment !== root || /Scope:\s*(?:User|Project)/i.test(output) || /Status:\s*(?:disabled|failed)/i.test(output))
            throw new SetupError('Claude did not confirm the local project binding and private storage root. Inspect /mcp and the effective entry, then retry.', 'SERVER_SHADOWED');
    }
    const legacy = await discoverEffectiveEntries(adapter, { run });
    if (legacy.some(e => e.enabled !== false))
        throw conflict();
    return { ok: true, mode: 'native', scope: 'project', client: adapter.client, serverName: adapter.serverName, projectDir: adapter.projectDir, restartRequired: true };
}
