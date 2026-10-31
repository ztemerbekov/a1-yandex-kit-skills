import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, chmod, stat, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { test } from "node:test";
import { createConnectionStore, resolveConnectionsRoot, ConnectionStorageError } from "./connections.mjs";

const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";
const record = { version: 1 as const, token: "private-token-A", store_id: "store-A", store_name: "Shop A", store_url: "https://a.example" };

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "kit-connections-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "private");
  return { dir, root, store: createConnectionStore({ storageRoot: root }) };
}

test("two projects select separate immutable connection snapshots without writing tokens to bindings", async (t) => {
  const { dir, root, store } = await fixture(t);
  const a = join(dir, "A", ".yandex-kit", "project.json");
  const b = join(dir, "B", ".yandex-kit", "project.json");
  const saved = await store.writeConnection(idA, record, { expectedRevision: null });
  await store.writeConnection(idB, { ...record, token: "private-token-B", store_id: "store-B" }, { expectedRevision: null });
  await store.writeBinding(a, { version: 1, connection_id: idA }, { expectedRevision: null });
  await store.writeBinding(b, { version: 1, connection_id: idB }, { expectedRevision: null });
  assert.equal((await store.readConnection((await store.readBinding(a)).value.connection_id)).value.token, "private-token-A");
  assert.equal((await store.readConnection((await store.readBinding(b)).value.connection_id)).value.store_id, "store-B");
  assert.equal((await readFile(a, "utf8")).includes("private-token"), false);
  assert.equal(JSON.stringify(saved).includes("private-token"), false);
  const snapshot = await store.readConnection(idA);
  assert.ok(Object.isFrozen(snapshot.value));
  assert.equal(JSON.stringify(snapshot).includes("private-token"), false);
  if (process.platform !== "win32") {
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, `${idA}.json`))).mode & 0o777, 0o600);
  }
});

test("storage root overrides are explicit, absolute and independent of HOME/CODEX_HOME", () => {
  assert.equal(resolveConnectionsRoot({ env: {} }), join(homedir(), ".a1-yandex-kit", "connections"));
  assert.equal(resolveConnectionsRoot({ env: { YANDEX_KIT_CONNECTIONS_DIR: "/tmp/kit-test" } }), "/tmp/kit-test");
  assert.equal(resolveConnectionsRoot({ storageRoot: "/tmp/explicit", env: { YANDEX_KIT_CONNECTIONS_DIR: "/tmp/other" } }), "/tmp/explicit");
  assert.throws(() => resolveConnectionsRoot({ storageRoot: "relative" }), ConnectionStorageError);
  assert.throws(() => resolveConnectionsRoot({ env: { YANDEX_KIT_CONNECTIONS_DIR: "" } }), ConnectionStorageError);
});

for (const invalid of ["../outside", "/tmp/outside", "", "not-a-uuid", `${idA}/../../outside`, `${idA}\\outside`]) {
  test(`connection IDs reject unsafe or invalid input: ${JSON.stringify(invalid)}`, async (t) => {
    const { store } = await fixture(t);
    await assert.rejects(store.readConnection(invalid), ConnectionStorageError);
    await assert.rejects(store.writeConnection(invalid, record, { expectedRevision: null }), ConnectionStorageError);
  });
}

test("malformed, unsupported and incomplete records fail closed without exposing their contents", async (t) => {
  const { dir, root, store } = await fixture(t);
  await mkdir(root, { mode: 0o700 });
  const file = join(root, `${idA}.json`);
  for (const value of ["private-token-A", JSON.stringify({ ...record, version: 2 }), JSON.stringify({ ...record, token: " " }), JSON.stringify({ version: 1, token: record.token }), JSON.stringify({ ...record, store_id: "" })]) {
    await writeFile(file, value, { mode: 0o600 });
    await assert.rejects(store.readConnection(idA), (err: unknown) => {
      assert.ok(err instanceof ConnectionStorageError);
      assert.equal(String(err).includes("private-token-A"), false);
      return true;
    });
  }
  const binding = join(dir, "project.json");
  for (const value of ["{private-token-A", JSON.stringify({ version: 2, connection_id: idA }), JSON.stringify({ version: 1, connection_id: "../outside" }), JSON.stringify({ version: 1, connection_id: idA, token: record.token })]) {
    await writeFile(binding, value);
    await assert.rejects(store.readBinding(binding), ConnectionStorageError);
  }
  await assert.rejects(store.readBinding(join(dir, "missing.json")), { code: "missing_binding" });
  await assert.rejects(store.readConnection(idB), { code: "missing_connection" });
});

test("CAS writes reject conflicting, stale and concurrent changes while preserving the winner", async (t) => {
  const { dir, store } = await fixture(t);
  const first = await store.writeConnection(idA, record, { expectedRevision: null });
  await assert.rejects(store.writeConnection(idA, { ...record, token: "replacement" }, { expectedRevision: null }), { code: "conflict" });
  const changes = await Promise.allSettled([
    store.writeConnection(idA, { ...record, token: "second-A" }, { expectedRevision: first.revision }),
    store.writeConnection(idA, { ...record, token: "second-B" }, { expectedRevision: first.revision }),
  ]);
  assert.equal(changes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(changes.filter((r) => r.status === "rejected").length, 1);
  const winner = await store.readConnection(idA);
  assert.ok(["second-A", "second-B"].includes(winner.value.token));
  await assert.rejects(store.removeConnection(idA, { expectedRevision: first.revision }), { code: "conflict" });
  await store.removeConnection(idA, { expectedRevision: winner.revision });
  await assert.rejects(store.readConnection(idA), { code: "missing_connection" });
  const path = join(dir, "project.json");
  const binding = await store.writeBinding(path, { version: 1, connection_id: idA }, { expectedRevision: null });
  const newer = await store.writeBinding(path, { version: 1, connection_id: idB }, { expectedRevision: binding.revision });
  await assert.rejects(store.removeBinding(path, { expectedRevision: binding.revision }), { code: "conflict" });
  assert.equal((await store.readBinding(path)).value.connection_id, idB);
  await store.removeBinding(path, { expectedRevision: newer.revision });
});

test("private reads reject insecure permissions and symlink targets without changing their destination", async (t) => {
  const { dir, root, store } = await fixture(t);
  await store.writeConnection(idA, record, { expectedRevision: null });
  if (process.platform !== "win32") {
    await chmod(join(root, `${idA}.json`), 0o644);
    await assert.rejects(store.readConnection(idA), { code: "unsafe_storage" });
    await chmod(join(root, `${idA}.json`), 0o600);
    await chmod(root, 0o755);
    await assert.rejects(store.readConnection(idA), { code: "unsafe_storage" });
    await chmod(root, 0o700);
  }
  const outside = join(dir, "outside.json");
  await writeFile(outside, JSON.stringify(record), { mode: 0o600 });
  await symlink(outside, join(root, `${idB}.json`));
  await assert.rejects(store.readConnection(idB), { code: "unsafe_storage" });
  await assert.rejects(store.writeConnection(idB, record, { expectedRevision: null }), ConnectionStorageError);
  assert.equal(await readFile(outside, "utf8"), JSON.stringify(record));
});

test("project transaction locks fail closed on contention and release after failure", async (t) => {
  const { dir, store } = await fixture(t);
  const path = join(dir, ".yandex-kit", "project.json");
  await assert.rejects(store.withProjectLock(path, async () => {
    await assert.rejects(store.withProjectLock(path, async () => {}), { code: "conflict" });
    await store.writeBinding(path, { version: 1, connection_id: idA }, { expectedRevision: null });
    throw new Error("fixture failure");
  }), /fixture failure/);
  assert.equal(await store.withProjectLock(path, async () => "released"), "released");
});
