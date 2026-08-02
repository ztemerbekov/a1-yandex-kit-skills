#!/usr/bin/env node

import { writeFileSync } from "node:fs";

const delayMs = Number(process.env.FAKE_MCP_DELAY_MS || 0);
const authStatus = Number(process.env.FAKE_MCP_AUTH_STATUS || 0);
if (process.env.FAKE_MCP_PID_FILE) {
  writeFileSync(process.env.FAKE_MCP_PID_FILE, String(process.pid));
}

let buffer = "";

function send(message) {
  const write = () => process.stdout.write(`${JSON.stringify(message)}\n`);
  if (delayMs > 0) setTimeout(write, delayMs);
  else write();
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const newline = buffer.indexOf("\n");
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id === undefined) continue;

    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-yandex-kit", version: "1.0.0" },
        },
      });
      continue;
    }
    if (message.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "get_store",
              description: "Read the current store",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
      continue;
    }
    if (message.method === "tools/call") {
      if (authStatus > 0) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Invalid Authorization token",
                  code: "UNAUTHENTICATED",
                  status: authStatus,
                }),
              },
            ],
          },
        });
        continue;
      }
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                id: "store-1",
                slug: "test-store",
                b2c_url: "https://test.example",
              }),
            },
          ],
        },
      });
    }
  }
});
