import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  PortablePluginValidationError,
  validatePortableAgentPlugin,
} from "./validate-agent-plugin.js";

test("portable package validates against the pinned Agent Plugins schemas", () => {
  const result = validatePortableAgentPlugin();

  assert.equal(result.pluginName, "a1-yandex-kit-skills");
  assert.equal(result.pluginVersion, "1.3.1");
  assert.deepEqual(result.mcpServerNames, ["yandex-kit"]);
  assert.equal(result.skillNames.length, 11);
  assert.ok(result.skillNames.includes("a1-yandex-kit-setup"));
});

test("portable validation rejects shell fallback expansion in MCP configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugin-"));
  mkdirSync(join(root, "skills", "example"), { recursive: true });
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "example",
      version: "1.0.0",
      description: "example",
    }),
  );
  writeFileSync(
    join(root, "mcp.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        example: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "${YANDEX_KIT_TOKEN:-}" },
        },
      },
    }),
  );
  writeFileSync(join(root, "skills", "example", "SKILL.md"), "---\nname: example\n---\n");

  assert.throws(
    () => validatePortableAgentPlugin(root),
    (error: unknown) =>
      error instanceof PortablePluginValidationError &&
      error.issues.some((issue) => issue.code === "non-portable-shell-expansion"),
  );
});

test("portable validation rejects host-specific fields in the root manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugin-"));
  mkdirSync(join(root, "skills", "example"), { recursive: true });
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "example",
      version: "1.0.0",
      description: "example",
      skills: "./skills",
    }),
  );
  writeFileSync(
    join(root, "mcp.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {},
    }),
  );
  writeFileSync(join(root, "skills", "example", "SKILL.md"), "---\nname: example\n---\n");

  assert.throws(
    () => validatePortableAgentPlugin(root),
    (error: unknown) =>
      error instanceof PortablePluginValidationError &&
      error.issues.some((issue) => issue.code === "schema-additionalProperties"),
  );
});

test("portable validation rejects a skill symlink that escapes the package root", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugin-"));
  const outside = mkdtempSync(join(tmpdir(), "agent-plugin-outside-"));
  mkdirSync(join(root, "skills"), { recursive: true });
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "example",
      version: "1.0.0",
      description: "example",
    }),
  );
  writeFileSync(
    join(root, "mcp.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {},
    }),
  );
  writeFileSync(join(outside, "SKILL.md"), "---\nname: example\n---\n");
  symlinkSync(outside, join(root, "skills", "example"), "dir");

  assert.throws(
    () => validatePortableAgentPlugin(root),
    (error: unknown) =>
      error instanceof PortablePluginValidationError &&
      error.issues.some((issue) => issue.code === "symlink-escapes-root"),
  );
});
