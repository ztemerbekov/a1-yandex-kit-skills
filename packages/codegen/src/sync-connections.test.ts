import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { syncConnectionsModule } from "./sync-connections.js";

test("connection storage sync is byte-stable and replaces stale copies", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kit-storage-sync-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "source.mjs");
  const destination = join(dir, "lib", "connections.mjs");
  writeFileSync(source, "export const fixture = 1;\n");
  syncConnectionsModule(source, destination);
  assert.equal(existsSync(destination), true);
  assert.equal(readFileSync(destination, "utf8"), "export const fixture = 1;\n");
  writeFileSync(source, "export const fixture = 2;\n");
  syncConnectionsModule(source, destination);
  syncConnectionsModule(source, destination);
  assert.equal(readFileSync(destination, "utf8"), "export const fixture = 2;\n");
});

test("shipped setup storage matches canonical source and runs without npm or TypeScript", (t) => {
  const canonical = readFileSync(new URL("../../core/src/connections.mjs", import.meta.url));
  const shipped = readFileSync(new URL("../../../skills/a1-yandex-kit-setup/scripts/lib/connections.mjs", import.meta.url));
  assert.deepEqual(shipped, canonical);
  const dir = mkdtempSync(join(tmpdir(), "kit-standalone-storage-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "connections.mjs"), shipped);
  const program = `import { createConnectionStore } from './connections.mjs';
    const store = createConnectionStore({ storageRoot: new URL('./private/', import.meta.url).pathname });
    const id = '11111111-1111-4111-8111-111111111111';
    await store.writeConnection(id, { version: 1, token: 'fixture-secret', store_id: 'standalone' }, { expectedRevision: null });
    const loaded = await store.readConnection(id);
    if (loaded.value.token !== 'fixture-secret' || JSON.stringify(loaded).includes('fixture-secret')) process.exit(1);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
