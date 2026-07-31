import assert from "node:assert/strict";
import test from "node:test";

import * as publicSetup from "./setup-lib.mjs";
import {
  CLIENT_PROFILES,
  getClientCheck,
  normalizeClient,
} from "./lib/client-profiles.mjs";
import {
  CONFIG_FORMATS,
  inspectConfig,
  mergeConfig,
} from "./lib/config/index.mjs";

const SECRET = "y0_AgAAAA-module-test";

test("setup-lib preserves the public module contract", () => {
  const expected = [
    "BACKUP_SUFFIX",
    "FALLBACK_SERVER_NAME",
    "SERVER_ARGS",
    "SERVER_COMMAND",
    "SERVER_NAME",
    "SetupError",
    "TOKEN_KEY",
    "TOKEN_PLACEHOLDER",
    "assertNode20",
    "buildSpawnInvocation",
    "checkPrerequisites",
    "clientCheck",
    "configureAdapter",
    "configureNative",
    "defaultConfigPath",
    "inspectAdapter",
    "inspectJson",
    "inspectToml",
    "inspectYaml",
    "mergeJson",
    "mergeToml",
    "mergeYaml",
    "normalizeClient",
    "projectShadowsServer",
    "resolveAdapter",
    "rollbackChange",
    "selectManagedAdapter",
    "smokeAdapter",
    "smokeMcp",
  ];

  assert.deepEqual(Object.keys(publicSetup).sort(), expected.sort());
});

test("every config format has the common inspect and merge interface", () => {
  assert.deepEqual([...CONFIG_FORMATS.keys()], [
    "mcp-json",
    "vscode-json",
    "openclaw-json",
    "codex-toml",
    "hermes-yaml",
  ]);

  for (const [format, adapter] of CONFIG_FORMATS) {
    assert.equal(typeof adapter.inspect, "function", `${format} inspect`);
    assert.equal(typeof adapter.merge, "function", `${format} merge`);

    const merged = mergeConfig("", format, SECRET, `<${format}>`);
    assert.deepEqual(inspectConfig(merged, format, `<${format}>`), {
      entryPresent: true,
      configured: true,
      canonical: true,
      tokenPresent: true,
      token: SECRET,
    });
  }
});

test("one client registry owns aliases, formats, paths, and client checks", () => {
  assert.deepEqual(
    CLIENT_PROFILES.map(({ id, format }) => [id, format]),
    [
      ["claude-code", "mcp-json"],
      ["claude-desktop", "mcp-json"],
      ["cursor", "mcp-json"],
      ["codex", "codex-toml"],
      ["vscode", "vscode-json"],
      ["kimi", "mcp-json"],
      ["hermes", "hermes-yaml"],
      ["openclaw", "openclaw-json"],
    ],
  );
  assert.equal(normalizeClient("openai-codex"), "codex");
  assert.equal(normalizeClient("hermes-agent"), "hermes");

  const checks = Object.fromEntries(
    CLIENT_PROFILES.map(({ id }) => [
      id,
      getClientCheck(id, "yandex-kit", `/tmp/${id}`)?.command ?? null,
    ]),
  );
  assert.deepEqual(checks, {
    "claude-code": "claude",
    "claude-desktop": null,
    cursor: "cursor-agent",
    codex: "codex",
    vscode: null,
    kimi: "kimi",
    hermes: null,
    openclaw: "openclaw",
  });
});
