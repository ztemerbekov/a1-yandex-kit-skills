import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KitClient } from "yandex-kit-core";

import { registerVideoTools } from "./videos.js";

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
  registerVideoTools(server, client);
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { calls, mcp };
}

function resultText(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

test("registers exactly the four video tools with correct annotations", async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["get_video", "list_videos", "upload_video", "upload_video_from_url"],
  );
  const readOnly = new Set(["list_videos", "get_video"]);
  for (const tool of tools) {
    assert.equal(
      tool.annotations?.readOnlyHint,
      readOnly.has(tool.name) ? true : undefined,
      `${tool.name} readOnlyHint`,
    );
  }
});

test("list_videos defaults the required status filter to all four statuses", async () => {
  const { calls, mcp } = await setup({ videos: [], total_count: 0 });
  await mcp.callTool({ name: "list_videos", arguments: {} });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/videos");
  assert.deepEqual(url.searchParams.getAll("status"), [
    "UPLOADED",
    "PROCESSING",
    "READY",
    "ERROR",
  ]);
});

test("list_videos passes an explicit status filter and clamps per_page", async () => {
  const { calls, mcp } = await setup({ videos: [], total_count: 0 });
  await mcp.callTool({ name: "list_videos", arguments: { status: ["READY"], per_page: 999 } });
  const url = new URL(calls[0]!.url);
  assert.deepEqual(url.searchParams.getAll("status"), ["READY"]);
  assert.equal(url.searchParams.get("per_page"), "100");
});

test("get_video hits /v1/videos/{video_id}", async () => {
  const { calls, mcp } = await setup({ id: "v1", status: "READY" });
  await mcp.callTool({ name: "get_video", arguments: { video_id: "vid-42" } });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/videos/vid-42");
  assert.equal(calls[0]!.init?.method, "GET");
});

test("upload_video POSTs multipart form data from content_base64", async () => {
  const { calls, mcp } = await setup({ id: "v1" });
  const res = await mcp.callTool({
    name: "upload_video",
    arguments: { content_base64: Buffer.from("fake-mp4").toString("base64"), filename: "promo.mp4" },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/videos");
  assert.equal(calls[0]!.init?.method, "POST");
  const body = calls[0]!.init?.body as FormData;
  assert.ok(body instanceof FormData);
  const file = body.get("file") as File;
  assert.equal(file.name, "promo.mp4");
  assert.equal(await file.text(), "fake-mp4");
});

test("upload_video reads a file from disk and defaults the title to its basename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kit-video-"));
  const path = join(dir, "clip.mov");
  await writeFile(path, "bytes");
  try {
    const { calls, mcp } = await setup({ id: "v1" });
    await mcp.callTool({ name: "upload_video", arguments: { file_path: path } });
    assert.equal(calls.length, 1);
    const file = (calls[0]!.init?.body as FormData).get("file") as File;
    assert.equal(file.name, "clip.mov");
    assert.equal(await file.text(), "bytes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("upload_video with both sources fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "upload_video",
    arguments: { file_path: "/tmp/x.mp4", content_base64: "aGk=", filename: "x.mp4" },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "FILE_SOURCE_REQUIRED");
  assert.equal(calls.length, 0);
});

test("upload_video with content_base64 but no filename fails without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "upload_video",
    arguments: { content_base64: "aGk=" },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "FILENAME_REQUIRED");
  assert.equal(calls.length, 0);
});

test("upload_video_from_url POSTs the link as JSON to /v1/videos/from_url", async () => {
  const { calls, mcp } = await setup({ id: "v1", status: "UPLOADED" });
  const res = await mcp.callTool({
    name: "upload_video_from_url",
    arguments: { url: "https://disk.yandex.ru/i/abcdef123456" },
  });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/videos/from_url");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), {
    url: "https://disk.yandex.ru/i/abcdef123456",
  });
});

test("upload_video_from_url rejects an empty link without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({ name: "upload_video_from_url", arguments: { url: "" } });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "LOCAL_VALIDATION_ERROR");
  assert.equal(calls.length, 0);
});

test("upload_video rejects malformed base64 without any network call", async () => {
  const { calls, mcp } = await setup();
  const res = await mcp.callTool({
    name: "upload_video",
    arguments: { content_base64: "aGk", filename: "x.mp4" },
  });
  assert.equal((res as { isError?: boolean }).isError, true);
  assert.equal(JSON.parse(resultText(res)).code, "INVALID_BASE64");
  assert.equal(calls.length, 0);
});
