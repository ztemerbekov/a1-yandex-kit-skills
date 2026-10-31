#!/usr/bin/env node
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const executable = path.basename(process.argv[1]);
if (executable === 'npx') {
    if (process.argv[2] === '--version')
        process.stdout.write('fixture-npx\n');
    else {
        process.argv = [process.execPath, process.env.KIT_TEST_RUNTIME, ...process.argv.slice(4)];
        await import(process.env.KIT_TEST_RUNTIME);
    }
}
else if (executable === 'codex') {
    if (process.argv[3] === 'list')
        process.stdout.write('[]\n');
    else {
        const config = await readFile(path.join(process.cwd(), '.codex', 'config.toml'), 'utf8');
        const args = JSON.parse(config.match(/^args = (.+)$/m)[1]);
        const root = JSON.parse(config.match(/^YANDEX_KIT_CONNECTIONS_DIR = (.+)$/m)[1]);
        process.stdout.write(JSON.stringify({ name: 'a1-yandex-kit-project', enabled: true, transport: { command: 'npx', args, env: { YANDEX_KIT_CONNECTIONS_DIR: root } } }) + '\n');
    }
}
else
    throw new Error('Unexpected fixture executable');
