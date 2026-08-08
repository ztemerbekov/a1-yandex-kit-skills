import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerFileTools } from "./files.js";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

async function setup(payload: unknown = { ok: true }) {
  const calls: RecordedCall[] = [];
  const client = new KitClient({
    token: "t",
    rps: 1000,
    fetchImpl: (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerFileTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("registers exactly upload_file and get_file", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_file", "upload_file"]);
  const getFile = tools.find((t) => t.name === "get_file");
  assert.equal(getFile?.annotations?.readOnlyHint, true);
});

test("upload_file with both file_path and content_base64 fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "upload_file",
    arguments: { file_path: "/tmp/x.png", content_base64: "aGk=", filename: "x.png" },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "FILE_SOURCE_REQUIRED");
  assert.equal(calls.length, 0);
});

test("upload_file rejects empty content_base64 without any network call", async () => {
  // "" passes both format checks, yet a zero-byte upload is never valid.
  const { calls, mcp } = await setup();
  for (const empty of ["", "\n \t"]) {
    const res = await mcp.callTool({
      name: "upload_file",
      arguments: { content_base64: empty, filename: "x.png" },
    });
    assert.equal((res as { isError?: boolean }).isError, true, JSON.stringify(empty));
    assert.equal(JSON.parse(resultText(res)).code, "INVALID_BASE64");
  }
  assert.equal(calls.length, 0);
});

test("upload_file with neither source fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({ name: "upload_file", arguments: {} });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "FILE_SOURCE_REQUIRED");
  assert.equal(calls.length, 0);
});

test("upload_file with content_base64 but no filename fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "upload_file",
    arguments: { content_base64: "aGk=" },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "FILENAME_REQUIRED");
  assert.equal(calls.length, 0);
});

test("upload_file with malformed base64 fails without any network call", async () => {
  const { calls, mcp } = await setup();
  // "aGVsbG" is truncated (length not a multiple of 4); "Hello world!!" has invalid characters.
  for (const content_base64 of ["aGVsbG", "Hello world!!"]) {
    const res = await mcp.callTool({
      name: "upload_file",
      arguments: { content_base64, filename: "x.bin" },
    });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.equal(JSON.parse(resultText(res)).code, "INVALID_BASE64");
  }
  assert.equal(calls.length, 0);
});

test("upload_file with content_base64 posts FormData without a manual content-type", async () => {
  const { calls, mcp } = await setup({ id: "f1" });
  const res = await mcp.callTool({
    name: "upload_file",
    arguments: { content_base64: Buffer.from("hello").toString("base64"), filename: "hello.txt" },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/files");
  assert.equal(calls[0]!.init?.method, "POST");
  const body = calls[0]!.init?.body;
  assert.ok(body instanceof FormData, "body must be a FormData instance");
  const file = body.get("file") as File;
  assert.equal(file.name, "hello.txt");
  assert.equal(await file.text(), "hello");
  // fetch must set the multipart boundary itself: no explicit Content-Type header.
  const headers = calls[0]!.init?.headers as Record<string, string>;
  const headerNames = Object.keys(headers).map((h) => h.toLowerCase());
  assert.ok(!headerNames.includes("content-type"), "no explicit content-type header expected");
});

test("upload_file with file_path reads the file and defaults filename to its basename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kit-upload-"));
  const filePath = join(dir, "logo.png");
  await writeFile(filePath, Buffer.from("png-bytes"));
  try {
    const { calls, mcp } = await setup({ id: "f1" });
    const res = await mcp.callTool({ name: "upload_file", arguments: { file_path: filePath } });
    assert.equal((res as { isError?: boolean }).isError, undefined);
    assert.equal(calls.length, 1);
    const body = calls[0]!.init?.body;
    assert.ok(body instanceof FormData, "body must be a FormData instance");
    const file = body.get("file") as File;
    assert.equal(file.name, "logo.png");
    assert.equal(await file.text(), "png-bytes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("upload_file with a missing file_path fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "upload_file",
    arguments: { file_path: "/nonexistent/definitely-missing.bin" },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(calls.length, 0);
});

test("get_file hits /v1/files/{id}", async () => {
  const { calls, mcp } = await setup({ id: "f1" });
  await mcp.callTool({ name: "get_file", arguments: { id: "file-42" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/files/file-42");
  assert.equal(calls[0]!.init?.method, "GET");
});
