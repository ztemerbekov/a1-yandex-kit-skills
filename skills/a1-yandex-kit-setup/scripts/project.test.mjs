import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveAdapter, configureAdapter, inspectAdapter, clientCheck, smokeAdapter } from './setup-lib.mjs';
import { createConnectionStore } from './lib/connections.mjs';
async function fixture(fn) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kit-project-'));
    try {
        const home = path.join(root, 'home');
        await mkdir(home);
        const env = { ...process.env, HOME: home, YANDEX_KIT_CONNECTIONS_DIR: path.join(root, 'secrets') };
        delete env.CODEX_HOME;
        delete env.YANDEX_KIT_TOKEN;
        delete env.YANDEX_KIT_BASE_URL;
        const adapter = (client, name = 'project with spaces') => resolveAdapter({ client, home, env, projectDir: path.join(root, name) });
        const options = (id, extra = {}) => ({ token: `private-${id}`, validateToken: async () => ({ ok: true, store: { id, name: `Store ${id}`, url: `https://${id}.example` } }), verifyRuntime: async () => ({ ok: true }), verifyClient: async () => ({ ok: true }), discover: async () => [], ...extra });
        await fn({ root, home, env, adapter, options, storage: createConnectionStore({ env }) });
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
}
test('Codex and Claude default to project; other clients and explicit user keep legacy paths', async () => fixture(async ({ home, adapter }) => {
    for (const c of ['codex', 'claude-code']) {
        const a = adapter(c);
        assert.equal(a.scope, 'project');
        assert.equal(a.serverName, 'a1-yandex-kit-project');
        assert.equal(a.bindingPath, path.join(a.projectDir, '.yandex-kit', 'project.json'));
    }
    assert.equal(adapter('codex').configPath, path.join(adapter('codex').projectDir, '.codex', 'config.toml'));
    assert.equal(adapter('claude-code').configPath, path.join(home, '.claude.json'));
    assert.equal(resolveAdapter({ client: 'codex', scope: 'user', home, env: {} }).scope, 'user');
    assert.equal(adapter('cursor').scope, 'user');
}));
test('four projects retain different private stores; both agents reuse binding and setup is idempotent', async () => fixture(async ({ adapter, options, storage }) => {
    const ids = [];
    for (let i = 0; i < 4; i++) {
        const a = adapter(i < 2 ? 'codex' : 'claude-code', `store ${i}`);
        const r = await configureAdapter(a, options(String(i)));
        assert.equal(r.scope, 'project');
        assert.equal(r.restartRequired, true);
        const b = await storage.readBinding(a.bindingPath);
        ids.push(b.value.connection_id);
        assert.equal((await storage.readConnection(b.value.connection_id)).value.token, `private-${i}`);
        const state = await inspectAdapter(a);
        assert.equal(state.store.id, String(i));
        assert.equal(JSON.stringify(state).includes('private-'), false);
        const repeat = await configureAdapter(a, { ...options(String(i)), token: undefined });
        assert.equal(repeat.changed, false);
        const content = await readFile(a.configPath, 'utf8');
        assert.equal(content.includes('private-'), false);
        assert.ok(content.includes('--project-config'));
    }
    assert.equal(new Set(ids).size, 4);
    const a = adapter('codex', 'store 0'), b = adapter('claude-code', 'store 0');
    await configureAdapter(b, { ...options('0'), token: undefined });
    assert.deepEqual(await storage.readBinding(a.bindingPath), await storage.readBinding(b.bindingPath));
}));
test('token refresh rejects another store; change-store creates a new binding and retains old secret', async () => fixture(async ({ adapter, options, storage }) => {
    const a = adapter('codex');
    await configureAdapter(a, options('one'));
    const before = await storage.readBinding(a.bindingPath);
    await assert.rejects(configureAdapter(a, options('two')), e => e.code === 'STORE_MISMATCH');
    assert.deepEqual(await storage.readBinding(a.bindingPath), before);
    await configureAdapter(a, options('one', { token: 'refreshed' }));
    assert.equal((await storage.readConnection(before.value.connection_id)).value.token, 'refreshed');
    await configureAdapter(a, options('two', { changeStore: true }));
    assert.notEqual((await storage.readBinding(a.bindingPath)).value.connection_id, before.value.connection_id);
    assert.equal((await storage.readConnection(before.value.connection_id)).value.token, 'refreshed');
}));
test('missing binding never falls back to inherited token', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('codex');
    const s = await inspectAdapter(a);
    assert.equal(s.configured, false);
    await assert.rejects(configureAdapter(a, { ...options('x'), token: undefined }), e => e.code === 'TOKEN_REQUIRED');
    await assert.rejects(smokeAdapter(a), e => e.code === 'missing_binding');
}));
test('failed post-write runtime verification rolls back all created files', async () => fixture(async ({ adapter, options, storage }) => {
    const a = adapter('codex');
    await assert.rejects(configureAdapter(a, options('one', { verifyRuntime: async () => { throw new Error('offline'); } })), /offline/);
    await assert.rejects(storage.readBinding(a.bindingPath), e => e.code === 'missing_binding');
    await assert.rejects(readFile(a.configPath), { code: 'ENOENT' });
}));
test('Codex effective check uses project cwd and exact binding without replacing CODEX_HOME', async () => fixture(async ({ adapter, options, env }) => {
    const a = adapter('codex');
    await configureAdapter(a, options('one'));
    const calls = [];
    const r = await clientCheck(a, { run: async (c, args, opts) => { calls.push({ c, args, opts }); return { available: true, code: 0, stdout: JSON.stringify(args[1] === 'get' ? { name: a.serverName, enabled: true, transport: { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest', '--project-config', a.bindingPath], env: { YANDEX_KIT_CONNECTIONS_DIR: env.YANDEX_KIT_CONNECTIONS_DIR } } } : [nativeManaged(a)]), stderr: '' }; } });
    assert.equal(r.ok, true);
    assert.equal(calls[0].opts.cwd, a.projectDir);
    assert.equal(calls[0].opts.env.CODEX_HOME, env.CODEX_HOME);
    assert.deepEqual(calls[0].args, ['mcp', 'get', a.serverName, '--json']);
    await assert.rejects(clientCheck(a, { run: async () => ({ available: true, code: 0, stdout: JSON.stringify({ name: a.serverName, enabled: true, transport: { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest'] } }), stderr: '' }) }), e => e.code === 'SERVER_SHADOWED');
}));
test('migration disables identity-confirmed Codex legacy entries locally and preserves targeted tool policy', async () => fixture(async ({ adapter, options, home }) => {
    const a = adapter('codex');
    const global = `[mcp_servers.yandex-kit]\ncommand = "npx"\nargs = ["-y", "mcp-yandex-kit@latest"]\ndefault_tools_approval_mode = "prompt"\n[mcp_servers.yandex-kit.env]\nYANDEX_KIT_TOKEN = "old-private"\n[mcp_servers.yandex-kit.tools.delete_product]\napproval_mode = "deny"\n[mcp_servers.a1-yandex-kit]\ncommand = "other"\nargs = []\n`;
    await mkdir(path.dirname(a.userConfigPath), { recursive: true });
    await writeFile(a.userConfigPath, global);
    const r = await configureAdapter(a, { ...options('old'), token: undefined });
    assert.equal(r.store.id, 'old');
    assert.equal(await readFile(a.userConfigPath, 'utf8'), global);
    const content = await readFile(a.configPath, 'utf8');
    assert.match(content, /mcp_servers\."yandex-kit"\]\nenabled = false/);
    assert.match(content, /a1-yandex-kit-project.tools.delete_product\]\napproval_mode = "deny"/);
    assert.match(content, /default_tools_approval_mode = "prompt"/);
    assert.equal(content.includes('old-private'), false);
    assert.equal(content.includes('[mcp_servers."a1-yandex-kit"]'), false);
}));
test('ambiguous multi-store migration requires explicit selection without modifying user settings', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('claude-code');
    const initial = JSON.stringify({ mcpServers: { 'yandex-kit': { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest'], env: { YANDEX_KIT_TOKEN: 'first' } }, 'a1-yandex-kit-global': { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest'], env: { YANDEX_KIT_TOKEN: 'second' } }, 'a1-yandex-kit': { command: 'not-kit', args: [] } } });
    await writeFile(a.configPath, initial);
    const opts = { ...options('unused'), token: undefined, validateToken: async (t) => ({ ok: true, store: { id: t, name: `Store ${t}` } }) };
    await assert.rejects(configureAdapter(a, opts), e => e.code === 'MIGRATION_SELECTION' && !e.message.includes('YANDEX_KIT_TOKEN'));
    assert.equal(await readFile(a.configPath, 'utf8'), initial);
    await configureAdapter(a, { ...opts, migrateServer: 'a1-yandex-kit-global' });
    const config = JSON.parse(await readFile(a.configPath, 'utf8'));
    assert.deepEqual(config.projects[a.projectDir].disabledMcpServers, ['yandex-kit', 'a1-yandex-kit-global']);
    assert.equal(config.projects[a.projectDir].disabledMcpjsonServers, undefined);
    assert.equal(config.mcpServers['yandex-kit'].env.YANDEX_KIT_TOKEN, 'first');
}));
test('Claude targeted allow ask deny rules are copied to project without widening global policy', async () => fixture(async ({ adapter, options, home }) => {
    const a = adapter('claude-code');
    await writeFile(a.configPath, JSON.stringify({ mcpServers: { 'yandex-kit': { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest'], env: { YANDEX_KIT_TOKEN: 'secret' } } } }));
    const p = path.join(home, '.claude', 'settings.json');
    await mkdir(path.dirname(p), { recursive: true });
    const initial = JSON.stringify({ permissions: { allow: ['mcp__yandex-kit__get_store'], ask: ['mcp__yandex-kit__update_product'], deny: ['mcp__yandex-kit__delete_product'] } });
    await writeFile(p, initial);
    await configureAdapter(a, options('x'));
    const rules = JSON.parse(await readFile(path.join(a.projectDir, '.claude', 'settings.local.json'), 'utf8')).permissions;
    for (const [d, tool] of [['allow', 'get_store'], ['ask', 'update_product'], ['deny', 'delete_product']])
        assert.ok(rules[d].includes(`mcp__a1-yandex-kit-project__${tool}`));
    assert.equal(await readFile(p, 'utf8'), initial);
    assert.equal(rules.allow.includes('mcp__a1-yandex-kit-project__*'), false);
}));
test('effective plugin policy uses actual identity; unresolved plugin conflict rolls back', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('codex');
    const entry = { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest'] };
    await assert.rejects(configureAdapter(a, options('x', { discover: async () => [{ name: 'plugin:kit:main', entry, kind: 'plugin' }] })), e => e.code === 'PLUGIN_CONFLICT');
    await assert.rejects(readFile(a.bindingPath), { code: 'ENOENT' });
    await configureAdapter(a, options('x', { discover: async () => [{ name: 'plugin:kit:main', entry, kind: 'plugin', pluginId: 'kit@market', serverKey: 'main' }] }));
    assert.match(await readFile(a.configPath, 'utf8'), /plugins\."kit@market".mcp_servers\."main"\]\nenabled = false/);
    await assert.rejects(clientCheck(a, { run: async (c, args) => ({ available: true, code: 0, stdout: JSON.stringify(args[1] === 'get' ? { name:a.serverName, enabled: true, transport: { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest', '--project-config', a.bindingPath], env: { YANDEX_KIT_CONNECTIONS_DIR: a.env.YANDEX_KIT_CONNECTIONS_DIR } } } : [nativeManaged(a), { name: 'plugin:kit:main', plugin_id:'kit@market', server_name:'main', enabled: true, transport: entry }]), stderr: '' }) }), e => e.code === 'PLUGIN_CONFLICT');
}));
test('rollback restores binding and config but retains pre-existing secrets, and refuses concurrent edits', async () => fixture(async ({ adapter, options, storage }) => {
    const { rollbackProject } = await import('./lib/project-setup.mjs');
    const a = adapter('codex');
    await configureAdapter(a, options('one'));
    const before = await storage.readBinding(a.bindingPath);
    const content = await readFile(a.configPath, 'utf8');
    const r = await configureAdapter(a, options('two', { changeStore: true }));
    await rollbackProject(a, r.transactionId);
    assert.deepEqual((await storage.readBinding(a.bindingPath)).value, before.value);
    assert.equal(await readFile(a.configPath, 'utf8'), content);
    assert.equal((await storage.readConnection(before.value.connection_id)).value.token, 'private-one');
    const r2 = await configureAdapter(a, options('three', { changeStore: true }));
    await writeFile(a.configPath, `${content}\n# concurrent edit\n`);
    await assert.rejects(rollbackProject(a, r2.transactionId), e => e.code === 'ROLLBACK_CONFLICT');
    assert.match(await readFile(a.configPath, 'utf8'), /concurrent edit/);
}));
test('parallel setup and stopped lock fail explicitly without deleting the lock', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('codex');
    let entered;
    const started = new Promise(r => entered = r);
    let release;
    const wait = new Promise(r => release = r);
    const pending = configureAdapter(a, options('one', { validateToken: async () => { entered(); await wait; return { ok: true, store: { id: 'one' } }; } }));
    await started;
    await assert.rejects(configureAdapter(a, options('two')), e => e.code === 'conflict');
    release();
    await pending;
    await writeFile(`${a.bindingPath}.setup.lock`, 'stopped');
    await assert.rejects(configureAdapter(a, options('one')), e => e.code === 'conflict');
    assert.equal(await readFile(`${a.bindingPath}.setup.lock`, 'utf8'), 'stopped');
}));
test('private connections root inside project is rejected before writing credentials', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('codex');
    a.storageRoot = path.join(a.projectDir, 'private');
    await assert.rejects(configureAdapter(a, options('one')), e => e.code === 'UNSAFE_CONNECTIONS_ROOT');
}));
test('automatic rollback preserves concurrent edits and refuses to silently restore over them', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('codex');
    await assert.rejects(configureAdapter(a, options('one', { verifyRuntime: async () => { await writeFile(a.configPath, '# concurrent owner edit\n'); throw new Error('startup failed'); } })), e => e.code === 'ROLLBACK_CONFLICT');
    assert.equal(await readFile(a.configPath, 'utf8'), '# concurrent owner edit\n');
}));
test('ambiguous targeted policy fails before publishing a binding', async () => fixture(async ({ adapter, options, home }) => {
    const a = adapter('claude-code');
    await writeFile(a.configPath, JSON.stringify({ mcpServers: { 'yandex-kit': { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest'] }, 'a1-yandex-kit-global': { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest'] } } }));
    const settings = path.join(home, '.claude', 'settings.json');
    await mkdir(path.dirname(settings), { recursive: true });
    await writeFile(settings, JSON.stringify({ permissions: { allow: ['mcp__yandex-kit__get_store'], deny: ['mcp__a1-yandex-kit-global__get_store'] } }));
    await assert.rejects(configureAdapter(a, options('one')), e => e.code === 'POLICY_CONFLICT');
    await assert.rejects(readFile(a.bindingPath), { code: 'ENOENT' });
}));
test('protected reconnect rejects a different store during validation before persistence', async () => fixture(async ({ adapter, options, storage }) => {
    const { projectTokenCallbacks } = await import('./lib/project-setup.mjs');
    const a = adapter('codex');
    await configureAdapter(a, options('one'));
    const before = await storage.readBinding(a.bindingPath);
    const callbacks = await projectTokenCallbacks(a, options('two'));
    await assert.rejects(callbacks.validateToken('private-two'), e => e.code === 'STORE_MISMATCH');
    assert.deepEqual(await storage.readBinding(a.bindingPath), before);
    const replacement = await projectTokenCallbacks(a, options('one'));
    const result = await replacement.validateToken('new-private');
    assert.equal(JSON.stringify(result).includes('new-private'), false);
    await replacement.persistToken('new-private');
    assert.equal((await storage.readConnection(before.value.connection_id)).value.token, 'new-private');
}));
test('detected managed permission policy blocks identity migration without changing admin files', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('codex');
    await mkdir(path.dirname(a.userConfigPath), { recursive: true });
    await writeFile(a.userConfigPath, '[mcp_servers.yandex-kit]\ncommand = "npx"\nargs = ["-y", "mcp-yandex-kit@latest"]\n');
    const managed = path.join(path.dirname(a.userConfigPath), 'managed_config.toml');
    const before = '[mcp_servers.yandex-kit]\ndisabled_tools = ["delete_product"]\n';
    await writeFile(managed, before);
    await assert.rejects(configureAdapter(a, options('one')), e => e.code === 'POLICY_CONFLICT');
    assert.equal(await readFile(managed, 'utf8'), before);
    await assert.rejects(readFile(a.bindingPath), { code: 'ENOENT' });
}));
test('project smoke spawns production runtime with binding, strips inherited token/base URL, and verifies store id', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('codex');
    await configureAdapter(a, options('one'));
    a.env = { ...a.env, YANDEX_KIT_TOKEN: 'inherited-foreign-token', YANDEX_KIT_BASE_URL: 'https://attacker.invalid', YANDEX_KIT_TELEMETRY: '0' };
    const runtime = path.resolve('packages/mcp/dist/index.js');
    const preload = path.resolve('skills/a1-yandex-kit-setup/scripts/fixtures/project-fetch.mjs');
    const result = await smokeAdapter(a, { command: process.execPath, args: ['--import', preload, runtime], timeoutMs: 5000, probe: null });
    assert.equal(result.store.id, 'one');
}));
test('targeted deny in tracked Claude project settings is preserved for the new identity', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('claude-code');
    await writeFile(a.configPath, JSON.stringify({ mcpServers: { 'yandex-kit': { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest'] } } }));
    const file = path.join(a.projectDir, '.claude', 'settings.json');
    await mkdir(path.dirname(file), { recursive: true });
    const before = JSON.stringify({ permissions: { deny: ['mcp__yandex-kit__update_product'] } });
    await writeFile(file, before);
    await configureAdapter(a, options('one'));
    const local = JSON.parse(await readFile(path.join(a.projectDir, '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(local.permissions.deny.includes('mcp__a1-yandex-kit-project__update_product'));
    assert.equal(await readFile(file, 'utf8'), before);
}));
test('Codex plugin-specific targeted deny follows the new project identity', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('codex');
    await mkdir(path.dirname(a.userConfigPath), { recursive: true });
    await writeFile(a.userConfigPath, '[plugins."kit@market".mcp_servers.main.tools.update_product]\napproval_mode = "deny"\n');
    await configureAdapter(a, options('one', { discover: async () => [{ name: 'plugin:kit:main', entry: { command: 'npx', args: ['-y', 'mcp-yandex-kit@latest'] }, kind: 'plugin', pluginId: 'kit@market', serverKey: 'main' }] }));
    assert.match(await readFile(a.configPath, 'utf8'), /a1-yandex-kit-project.tools.update_product\]\napproval_mode = "deny"/);
}));
test('malformed JSON diagnostics never quote secret-bearing configuration text', async () => fixture(async ({ adapter }) => {
    const a = adapter('claude-code');
    await writeFile(a.configPath, '{"token":"very-private-do-not-print", invalid}');
    await assert.rejects(inspectAdapter(a), e => e.code === 'MALFORMED_CONFIG' && !e.message.includes('very-private-do-not-print'));
}));
test('concurrent edit during verification cannot be reported as a ready transaction', async () => fixture(async ({ adapter, options }) => {
    const a = adapter('codex');
    await assert.rejects(configureAdapter(a, options('one', { verifyClient: async () => { await writeFile(a.configPath, '# owner changed this\n'); return { ok: true }; } })), e => e.code === 'ROLLBACK_CONFLICT');
    assert.equal(await readFile(a.configPath, 'utf8'), '# owner changed this\n');
}));
test('protected HTTP reconnect keeps wrong-store retry open and saves only a same-store token', async () => fixture(async ({ adapter, options, storage }) => {
    const { startTokenWeb } = await import('./setup-lib.mjs');
    const { projectTokenCallbacks } = await import('./lib/project-setup.mjs');
    const a = adapter('codex');
    await configureAdapter(a, options('one'));
    const b = await storage.readBinding(a.bindingPath);
    const callbacks = await projectTokenCallbacks(a, options('one', { validateToken: async (t) => ({ ok: true, store: { id: t === 'wrong-store' ? 'two' : 'one' } }) }));
    const web = await startTokenWeb({ ...callbacks, mode: 'replace', timeoutSeconds: 30 });
    try {
        const rejected = await fetch(web.url, { method: 'POST', body: new URLSearchParams({ token: 'wrong-store' }) });
        assert.equal(rejected.status, 200);
        assert.equal((await storage.readConnection(b.value.connection_id)).value.token, 'private-one');
        const response = await fetch(web.url, { method: 'POST', body: new URLSearchParams({ token: 'same-store-new-token' }) });
        assert.equal(response.status, 200);
        const done = await web.done;
        assert.equal(done.persisted.store.id, 'one');
        assert.equal(JSON.stringify(done).includes('same-store-new-token'), false);
        assert.equal((await storage.readConnection(b.value.connection_id)).value.token, 'same-store-new-token');
    }
    finally {
        web.stop();
        await web.done.catch(() => { });
    }
}));
test('actual CLI defaults status and configure to the shared project binding without touching user config', async () => fixture(async ({ adapter, options, home, root }) => {
    const { chmod, copyFile } = await import('node:fs/promises');
    const { spawnCaptured } = await import('./lib/process.mjs');
    const a = adapter('codex');
    await configureAdapter(a, options('one'));
    const before = await readFile(a.bindingPath, 'utf8');
    const bin = path.join(root, 'bin');
    await mkdir(bin);
    const wrapper = path.resolve('skills/a1-yandex-kit-setup/scripts/fixtures/project-cli.mjs');
    for (const name of ['npx', 'codex']) {
        await copyFile(wrapper, path.join(bin, name));
        await chmod(path.join(bin, name), 0o755);
    }
    const env = { ...a.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NODE_OPTIONS: `--import=${path.resolve('skills/a1-yandex-kit-setup/scripts/fixtures/project-cli-preload.mjs')}`, KIT_TEST_RUNTIME: path.resolve('packages/mcp/dist/index.js'), YANDEX_KIT_TELEMETRY: '0' };
    const cli = path.resolve('skills/a1-yandex-kit-setup/scripts/setup.mjs');
    for (const command of ['status', 'configure']) {
        const r = await spawnCaptured(process.execPath, [cli, command, '--client', 'codex', '--project-dir', a.projectDir, '--json'], { env, timeoutMs: 10000 });
        assert.equal(r.code, 0, r.stderr);
        const result = JSON.parse(r.stdout);
        assert.equal(result.scope, 'project');
        assert.equal(result.serverName, 'a1-yandex-kit-project');
        assert.equal(result.store.id, 'one');
        assert.equal(r.stdout.includes('private-one'), false);
    }
    assert.equal(await readFile(a.bindingPath, 'utf8'), before);
    await assert.rejects(readFile(path.join(home, '.codex', 'config.toml')), { code: 'ENOENT' });
}));

test('corrupt private rollback journals fail without echoing their secret text', async () => fixture(async ({adapter,options,env}) => {
    const {rollbackProject}=await import('./lib/project-setup.mjs');
    const a=adapter('codex');
    const result=await configureAdapter(a,options('one'));
    await writeFile(path.join(env.YANDEX_KIT_CONNECTIONS_DIR,'.setup-transactions',`${result.transactionId}.json`),'private-journal-secret');
    await assert.rejects(rollbackProject(a,result.transactionId),error=>error.code==='INVALID_ROLLBACK'&&!error.message.includes('private-journal-secret'));
}));

test('review: project Codex rejects user config overrides and ancestor symlink redirects', async () => fixture(async ({adapter,options,home,root}) => {
    const {symlink}=await import('node:fs/promises');
    const global=path.join(home,'.codex','config.toml');
    assert.throws(()=>resolveAdapter({client:'codex',home,env:{},projectDir:path.join(root,'selected'),configPath:global}),error=>error.code==='UNSAFE_CONFIG');
    assert.equal(resolveAdapter({client:'codex',scope:'user',home,env:{},configPath:global}).configPath,global);
    assert.throws(()=>resolveAdapter({client:'codex',home,env:{},projectDir:home}),error=>error.code==='UNSAFE_CONFIG');
    const {spawnCaptured}=await import('./lib/process.mjs');
    const rejected=await spawnCaptured(process.execPath,[path.resolve('skills/a1-yandex-kit-setup/scripts/setup.mjs'),'configure','--client','codex','--project-dir',path.join(root,'selected'),'--config',global,'--json'],{env:{...process.env,HOME:home,YANDEX_KIT_CONNECTIONS_DIR:path.join(root,'secrets')}});
    assert.equal(rejected.code,1);assert.match(rejected.stderr,/UNSAFE_CONFIG/);
    const a=adapter('codex');await mkdir(a.projectDir,{recursive:true});await mkdir(path.dirname(global),{recursive:true});await writeFile(global,'# global must survive\n');
    await symlink(path.dirname(global),path.join(a.projectDir,'.codex'));
    await assert.rejects(configureAdapter(a,options('one')),error=>error.code==='UNSAFE_CONFIG');
    assert.equal(await readFile(global,'utf8'),'# global must survive\n');await assert.rejects(readFile(a.bindingPath),{code:'ENOENT'});
}));

test('review: global KIT names cannot disable unrelated higher-scope servers in either client', async () => fixture(async ({adapter,options}) => {
    for(const client of ['codex','claude-code']) {
        const a=adapter(client,`shadow ${client}`);
        if(client==='codex') {
            await mkdir(path.dirname(a.userConfigPath),{recursive:true});await writeFile(a.userConfigPath,'[mcp_servers.yandex-kit]\ncommand = "npx"\nargs = ["-y", "mcp-yandex-kit@latest"]\n');
            await mkdir(path.dirname(a.configPath),{recursive:true});await writeFile(a.configPath,'[mcp_servers.yandex-kit]\ncommand = "unrelated"\nargs = []\n');
        } else await writeFile(a.configPath,JSON.stringify({mcpServers:{'yandex-kit':{command:'npx',args:['-y','mcp-yandex-kit@latest']}},projects:{[a.projectDir]:{mcpServers:{'yandex-kit':{command:'unrelated',args:[]}}}}}));
        const before=await readFile(a.configPath,'utf8');
        await assert.rejects(configureAdapter(a,options('one')),error=>error.code==='SERVER_CONFLICT');assert.equal(await readFile(a.configPath,'utf8'),before);await assert.rejects(readFile(a.bindingPath),{code:'ENOENT'});
    }
}));

test('review: ancestor Codex policy-only deny and tool selection follow inherited KIT transport',async()=>fixture(async({adapter,options,root})=>{
    const a=adapter('codex','ancestor/project');await mkdir(path.dirname(a.userConfigPath),{recursive:true});await writeFile(a.userConfigPath,'[mcp_servers.yandex-kit]\ncommand = "npx"\nargs = ["-y", "mcp-yandex-kit@latest"]\n');
    const ancestor=path.join(root,'ancestor','.codex','config.toml');await mkdir(path.dirname(ancestor),{recursive:true});const initial='[mcp_servers.yandex-kit]\ndisabled_tools = ["delete_product"]\n[mcp_servers.yandex-kit.tools.update_product]\napproval_mode = "deny"\n';await writeFile(ancestor,initial);
    await configureAdapter(a,options('one'));const content=await readFile(a.configPath,'utf8');assert.match(content,/disabled_tools = \["delete_product"\]/);assert.match(content,/a1-yandex-kit-project.tools.update_product\]\napproval_mode = "deny"/);assert.equal(await readFile(ancestor,'utf8'),initial);
}));

test('review: stale refresh rollback is refused after a later project store switch',async()=>fixture(async({adapter,options,storage})=>{
    const {rollbackProject}=await import('./lib/project-setup.mjs');const a=adapter('codex');await configureAdapter(a,options('one'));const original=await storage.readBinding(a.bindingPath);
    const refresh=await configureAdapter(a,options('one',{token:'refreshed-one'}));await configureAdapter(a,options('two',{changeStore:true}));const switched=await storage.readBinding(a.bindingPath);
    await assert.rejects(rollbackProject(a,refresh.transactionId),error=>error.code==='ROLLBACK_CONFLICT');assert.deepEqual(await storage.readBinding(a.bindingPath),switched);assert.equal((await storage.readConnection(original.value.connection_id)).value.token,'refreshed-one');
}));

test('review: Claude inventory accepts only supported empty/entry grammar and rejects unknown success output',async()=>fixture(async({adapter,options})=>{
    const {discoverEffectiveEntries}=await import('./lib/project-check.mjs');const a=adapter('claude-code');await configureAdapter(a,options('one'));
    const get=`Name: a1-yandex-kit-project\nScope: Local\nCommand: npx\nArgs: -y mcp-yandex-kit@latest --project-config ${a.bindingPath}\nEnvironment:\n  YANDEX_KIT_CONNECTIONS_DIR=${a.env.YANDEX_KIT_CONNECTIONS_DIR}\n`;
    const run=output=>async(command,args)=>({available:true,code:0,stdout:args[1]==='get'?get:output,stderr:''});
    for(const output of ['unsupported localized inventory','Checking MCP server health...\n','', 'other: unexpected truncated output'])await assert.rejects(clientCheck(a,{run:run(output)}),error=>error.code==='PLUGIN_CONFLICT');
    assert.deepEqual(await discoverEffectiveEntries(a,{run:run('No MCP servers configured. Use `claude mcp add` to add a server.\n')}),[]);
    assert.deepEqual((await discoverEffectiveEntries(a,{run:run('Checking MCP server health...\n\nother: npx unrelated-server - ✓ Connected\n')})).map(entry=>entry.name),['other']);
}));

function nativeManaged(adapter) {
    return {name:adapter.serverName,enabled:true,transport:{type:'stdio',command:'npx',args:['-y','mcp-yandex-kit@latest','--project-config',adapter.bindingPath],env:{YANDEX_KIT_CONNECTIONS_DIR:adapter.env.YANDEX_KIT_CONNECTIONS_DIR}}};
}
function nativeRun(adapter,list) {
    const managed=nativeManaged(adapter);
    return async (command,args)=>({available:true,code:0,stderr:'',stdout:adapter.client==='codex'?JSON.stringify(args[1]==='get'?managed:list):args[1]==='get'?`Name: ${adapter.serverName}\nScope: Local\nCommand: npx\nArgs: ${managed.transport.args.join(' ')}\nEnvironment:\nYANDEX_KIT_CONNECTIONS_DIR=${adapter.env.YANDEX_KIT_CONNECTIONS_DIR}\n`:list});
}
test('final: Claude project policy redirect fails before publication and preserves outside settings',async()=>fixture(async({adapter,options,home,env})=>{
    const {symlink}=await import('node:fs/promises');const a=adapter('claude-code');await mkdir(a.projectDir,{recursive:true});await mkdir(path.join(home,'.claude'));
    const outside=path.join(home,'.claude','settings.local.json'),before=JSON.stringify({permissions:{deny:['mcp__yandex-kit__update_product']}});await writeFile(outside,before);
    const config=JSON.stringify({mcpServers:{'yandex-kit':{command:'npx',args:['-y','mcp-yandex-kit@latest']}}});await writeFile(a.configPath,config);await symlink(path.join(home,'.claude'),path.join(a.projectDir,'.claude'));
    await assert.rejects(configureAdapter(a,options('one')),error=>error.code==='UNSAFE_CONFIG');assert.equal(await readFile(outside,'utf8'),before);assert.equal(await readFile(a.configPath,'utf8'),config);await assert.rejects(readFile(a.bindingPath),{code:'ENOENT'});
    const {readdir}=await import('node:fs/promises');await assert.rejects(readdir(env.YANDEX_KIT_CONNECTIONS_DIR),{code:'ENOENT'});
}));
test('final: Claude rollback refuses a redirected project policy target',async()=>fixture(async({adapter,options,home,root})=>{
    const {symlink,rename}=await import('node:fs/promises');const {rollbackProject}=await import('./lib/project-setup.mjs');const a=adapter('claude-code');await writeFile(a.configPath,JSON.stringify({mcpServers:{'yandex-kit':{command:'npx',args:['-y','mcp-yandex-kit@latest']}}}));await mkdir(path.join(home,'.claude'));await writeFile(path.join(home,'.claude','settings.json'),JSON.stringify({permissions:{deny:['mcp__yandex-kit__update_product']}}));
    const result=await configureAdapter(a,options('one'));const policy=path.join(a.projectDir,'.claude','settings.local.json'),content=await readFile(policy,'utf8');const outside=path.join(root,'outside-policy');await mkdir(outside);await writeFile(path.join(outside,'settings.local.json'),content);await rename(path.dirname(policy),`${path.dirname(policy)}.saved`);await symlink(outside,path.dirname(policy));
    await assert.rejects(rollbackProject(a,result.transactionId),error=>error.code==='UNSAFE_CONFIG'||error.code==='ROLLBACK_CONFLICT');assert.equal(await readFile(path.join(outside,'settings.local.json'),'utf8'),content);
}));
test('final: connection roots are outside every containing directory or worktree Git marker',async()=>fixture(async({adapter,options,root,home,env})=>{
    const {symlink,readdir}=await import('node:fs/promises');
    for(const marker of ['directory','file']) {
        const outer=path.join(root,`outer-${marker}`),inner=path.join(outer,'inner');await mkdir(inner,{recursive:true});
        for(const dir of [outer,inner])if(marker==='directory')await mkdir(path.join(dir,'.git'));else await writeFile(path.join(dir,'.git'),'gitdir: /fixture-only\n');
        const alias=path.join(root,`selected-${marker}`);await symlink(inner,alias);const privateRoot=path.join(outer,'private-connections');const a=resolveAdapter({client:'codex',home,env:{...env,YANDEX_KIT_CONNECTIONS_DIR:privateRoot},projectDir:alias});
        await assert.rejects(configureAdapter(a,options('one')),error=>error.code==='UNSAFE_CONNECTIONS_ROOT');await assert.rejects(readdir(privateRoot),{code:'ENOENT'});await assert.rejects(readFile(a.bindingPath),{code:'ENOENT'});
    }
}));
test('final: Codex inventory rejects unsupported records while preserving complete stdio and HTTP entries',async()=>fixture(async({adapter})=>{
    const {discoverEffectiveEntries}=await import('./lib/project-check.mjs');const a=adapter('codex');
    for(const list of [[{name:'legacy',enabled:true,transport:{type:'stdio',program:'npx',arguments:['-y','mcp-yandex-kit@latest']}}],[{name:'legacy',enabled:true,transport:{type:'future',command:'npx',args:['-y','mcp-yandex-kit@latest']}}],[null],[{name:'legacy',enabled:true}]])await assert.rejects(discoverEffectiveEntries(a,{run:nativeRun(a,list)}),error=>error.code==='PLUGIN_CONFLICT');
    const list=[nativeManaged(a),{name:'other',enabled:true,transport:{type:'stdio',command:'unrelated',args:[],env:null,env_vars:[],cwd:null}},{name:'remote',enabled:false,transport:{type:'streamable_http',url:'https://remote.example/mcp',bearer_token_env_var:null,http_headers:null,env_http_headers:null,http_headers_helper:null}}];
    assert.deepEqual((await discoverEffectiveEntries(a,{run:nativeRun(a,list)})).map(entry=>entry.name),list.map(entry=>entry.name));
}));
test('final: both clients require managed presence and matching identity in complete list after get',async()=>fixture(async({adapter,options})=>{
    for(const client of ['codex','claude-code']) {
        const a=adapter(client,`consistent ${client}`);await configureAdapter(a,options('one'));const managed=nativeManaged(a);
        const missing=client==='codex'?[[],[{name:'other',enabled:true,transport:{type:'stdio',command:'other-server',args:[]}}]]:['No MCP servers configured.','other: unrelated-server - ✓ Connected'];
        for(const list of missing)await assert.rejects(clientCheck(a,{run:nativeRun(a,list)}),error=>error.code==='PLUGIN_CONFLICT');
        const mismatch=client==='codex'?[{...managed,transport:{...managed.transport,args:['-y','mcp-yandex-kit@latest','--project-config','/wrong/project.json']}}]:`${a.serverName}: npx -y mcp-yandex-kit@latest --project-config /wrong/project.json - ✓ Connected`;
        await assert.rejects(clientCheck(a,{run:nativeRun(a,mismatch)}),error=>error.code==='PLUGIN_CONFLICT');
        const valid=client==='codex'?[managed,{name:'other',enabled:true,transport:{type:'streamable_http',url:'https://other.example/mcp'}}]:`${a.serverName}: npx ${managed.transport.args.join(' ')} - ✓ Connected\nother: https://other.example/mcp (HTTP) - ✓ Connected`;
        assert.equal((await clientCheck(a,{run:nativeRun(a,valid)})).ok,true);
    }
}));
test('final: unrelated inherited reserved project names conflict before either adapter publishes',async()=>fixture(async({adapter,options,env})=>{
    for(const client of ['codex','claude-code']) {
        const a=adapter(client,`reserved ${client}`);let file;
        if(client==='codex') {file=a.userConfigPath;await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'[mcp_servers.a1-yandex-kit-project]\ncommand = "unrelated-server"\nargs = []\n');}
        else {file=a.configPath;await writeFile(file,JSON.stringify({mcpServers:{'a1-yandex-kit-project':{command:'unrelated-server',args:[]}}}));}
        const before=await readFile(file,'utf8');await assert.rejects(configureAdapter(a,options('one')),error=>error.code==='SERVER_CONFLICT');assert.equal(await readFile(file,'utf8'),before);await assert.rejects(readFile(a.bindingPath),{code:'ENOENT'});
    }
    const {readdir}=await import('node:fs/promises');await assert.rejects(readdir(env.YANDEX_KIT_CONNECTIONS_DIR),{code:'ENOENT'});
}));
