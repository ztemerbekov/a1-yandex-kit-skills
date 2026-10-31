import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, mkdir, open, rename, unlink, chmod, realpath } from 'node:fs/promises';
import path from 'node:path';
import { SetupError } from './shared.mjs';
export const hash = content => createHash('sha256').update(content).digest('hex');
export async function readSnapshot(file) {
    try {
        const st = await lstat(file);
        if (!st.isFile() || st.isSymbolicLink())
            throw new SetupError('Configuration must be a regular file; inspect it before retrying.', 'UNSAFE_CONFIG');
        const content = await readFile(file, 'utf8');
        return { content, revision: hash(content) };
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return { content: '', revision: null };
        throw e;
    }
}
export async function withFileLocks(files, work) {
    const owned = [];
    try {
        for (const file of [...new Set(files)].sort()) {
            await mkdir(path.dirname(file), { recursive: true });
            const lock = `${file}.a1-kit-project.lock`;
            try {
                const fd = await open(lock, 'wx', 0o600);
                owned.push({ lock, fd });
            }
            catch (e) {
                if (e.code === 'EEXIST')
                    throw new SetupError('Another setup or a stopped setup holds a configuration lock. Inspect the lock before retrying; it is never removed automatically.', 'CONFIG_CONFLICT');
                throw e;
            }
        }
        return await work();
    }
    finally {
        for (const { lock, fd } of owned.reverse()) {
            await fd.close();
            await unlink(lock);
        }
    }
}
export async function replaceSnapshot(file, content, expectedRevision) {
    if ((await readSnapshot(file)).revision !== expectedRevision)
        throw new SetupError('Configuration changed concurrently; inspect it and retry.', 'CONFIG_CONFLICT');
    if (content === null) {
        await unlink(file);
        return null;
    }
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    let fd;
    try {
        fd = await open(temporary, 'wx', 0o600);
        await fd.writeFile(content, 'utf8');
        await fd.sync();
        await fd.close();
        fd = null;
        if ((await readSnapshot(file)).revision !== expectedRevision)
            throw new SetupError('Configuration changed concurrently; inspect it and retry.', 'CONFIG_CONFLICT');
        await rename(temporary, file);
        await chmod(file, 0o600);
        return hash(content);
    }
    finally {
        if (fd)
            await fd.close();
        await unlink(temporary).catch(e => { if (e.code !== 'ENOENT')
            throw e; });
    }
}

export async function canonicalPath(file) {
    try { return await realpath(file); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parent = path.dirname(file);
        if (parent === file) throw error;
        return path.join(await canonicalPath(parent), path.basename(file));
    }
}
export async function assertProjectConfigScope(adapter) {
    if (adapter.scope !== 'project' || adapter.client !== 'codex') return;
    const intended = path.join(path.resolve(adapter.projectDir), '.codex', 'config.toml');
    if (path.resolve(adapter.configPath) !== intended)
        throw new SetupError('Codex project configuration must stay in <project>/.codex/config.toml. Use --scope user for user config overrides.', 'UNSAFE_CONFIG');
    try {
        if ((await lstat(path.dirname(adapter.configPath))).isSymbolicLink())
            throw new SetupError('A symbolic link redirects the project Codex configuration. Restore a real project .codex directory before retrying.', 'UNSAFE_CONFIG');
    } catch(error) { if(error.code !== 'ENOENT') throw error; }
    const project = await canonicalPath(adapter.projectDir);
    const config = await canonicalPath(adapter.configPath);
    if (config !== path.join(project, '.codex', 'config.toml') || config === await canonicalPath(adapter.userConfigPath))
        throw new SetupError('A symbolic link redirects the project Codex configuration. Restore a real project .codex directory before retrying.', 'UNSAFE_CONFIG');
}
