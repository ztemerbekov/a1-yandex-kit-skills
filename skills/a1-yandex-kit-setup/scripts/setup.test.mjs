import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readTokenStdin } from "./setup.mjs";
import {
  BACKUP_SUFFIX,
  FALLBACK_SERVER_NAME,
  TOKEN_PLACEHOLDER,
  SetupError,
  assertNode20,
  buildSpawnInvocation,
  checkPrerequisites,
  clientCheck,
  configureAdapter,
  defaultConfigPath,
  inspectAdapter,
  inspectJson,
  inspectToml,
  inspectYaml,
  mergeJson,
  mergeToml,
  mergeYaml,
  probeNetwork,
  resolveAdapter,
  rollbackChange,
  selectManagedAdapter,
  smokeMcp,
} from "./setup-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const setupScript = path.join(scriptDir, "setup.mjs");
const fakeServer = path.join(scriptDir, "fixtures", "fake-mcp-server.mjs");
const SECRET_ONE = "y0_AgAAAA-secret-one";
const SECRET_TWO = "y0_AgAAAA-secret-two";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "yandex-kit-setup-"));
  try {
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function withEnv(entries, run) {
  const previous = {};
  for (const [key, value] of Object.entries(entries)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function waitFor(check, { timeoutMs = 5_000, intervalMs = 50 } = {}) {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("condition was not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function runCli(args, stdin = "", { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [setupScript, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

test("requires Node.js 20 or newer and an executable npx", async () => {
  assert.doesNotThrow(() => assertNode20("20.0.0"));
  assert.throws(
    () => assertNode20("18.20.0"),
    (error) => error instanceof SetupError && error.code === "NODE_VERSION",
  );
  assert.deepEqual(
    await checkPrerequisites({
      nodeVersion: "20.0.0",
      run: async () => ({
        available: true,
        code: 0,
        stdout: "10.8.2\n",
        stderr: "",
      }),
    }),
    {
      nodeVersion: "20.0.0",
      npxAvailable: true,
      npxVersion: "10.8.2",
    },
  );
  await assert.rejects(
    checkPrerequisites({
      nodeVersion: "20.0.0",
      run: async () => ({
        available: false,
        code: null,
        stdout: "",
        stderr: "",
      }),
    }),
    (error) =>
      error instanceof SetupError && error.code === "NPX_UNAVAILABLE",
  );
});

test("resolves user-level paths for all nine tested clients", () => {
  const home = "/users/test";
  const env = {
    APPDATA: "C:\\Users\\test\\AppData\\Roaming",
    CODEX_HOME: "/custom/codex",
    KIMI_CODE_HOME: "/custom/kimi",
    KIMI_DESKTOP_USER_DATA: "/custom/kimi-desktop",
    HERMES_HOME: "/custom/hermes",
  };
  const cases = [
    ["claude-code", "/users/test/.claude.json", "mcp-json"],
    [
      "claude-desktop",
      "/users/test/Library/Application Support/Claude/claude_desktop_config.json",
      "mcp-json",
    ],
    ["cursor", "/users/test/.cursor/mcp.json", "mcp-json"],
    ["codex", "/custom/codex/config.toml", "codex-toml"],
    [
      "vscode",
      "/users/test/Library/Application Support/Code/User/mcp.json",
      "vscode-json",
    ],
    ["kimi", "/custom/kimi/mcp.json", "mcp-json"],
    [
      "kimi-desktop",
      "/custom/kimi-desktop/daimon-share/daimon/config.json",
      "daimon-json",
    ],
    ["hermes", "/custom/hermes/config.yaml", "hermes-yaml"],
    ["openclaw", "/users/test/.openclaw/openclaw.json", "openclaw-json"],
  ];
  for (const [client, expected, format] of cases) {
    assert.equal(
      defaultConfigPath(client, { platform: "darwin", home, env }),
      expected,
    );
    assert.equal(
      resolveAdapter({ client, platform: "darwin", home, env }).format,
      format,
    );
  }
});

test("Kimi Desktop rejects unsupported platforms unless a dynamic adapter supplies a path", () => {
  assert.throws(
    () =>
      defaultConfigPath("kimi-desktop", {
        platform: "linux",
        home: "/users/test",
        env: {},
      }),
    (error) =>
      error instanceof SetupError && error.code === "UNSUPPORTED_PLATFORM",
  );

  assert.equal(
    resolveAdapter({
      client: "kimi-desktop",
      platform: "linux",
      configPath: "/verified/kimi/config.json",
      format: "daimon-json",
    }).configPath,
    "/verified/kimi/config.json",
  );
});

test("merges every JSON capability and preserves unrelated settings", () => {
  for (
    const format of [
      "mcp-json",
      "vscode-json",
      "daimon-json",
      "openclaw-json",
    ]
  ) {
    const root =
      format === "openclaw-json" || format === "daimon-json"
        ? { theme: "dark", mcp: { servers: {
            other: { command: "other" },
            "yandex-kit": {
              command: "old",
              args: ["old"],
              timeout: 99,
              env: { EXTRA: "kept", YANDEX_KIT_TOKEN: "old" },
            },
          } } }
        : {
            theme: "dark",
            [format === "vscode-json" ? "servers" : "mcpServers"]: {
              other: { command: "other" },
              "yandex-kit": {
                command: "old",
                args: ["old"],
                timeout: 99,
                env: { EXTRA: "kept", YANDEX_KIT_TOKEN: "old" },
              },
            },
          };
    const merged = mergeJson(JSON.stringify(root), format, SECRET_ONE);
    const parsed = JSON.parse(merged);
    const servers =
      format === "openclaw-json" || format === "daimon-json"
        ? parsed.mcp.servers
        : parsed[format === "vscode-json" ? "servers" : "mcpServers"];
    assert.deepEqual(servers.other, { command: "other" });
    assert.equal(servers["yandex-kit"].timeout, 99);
    assert.equal(servers["yandex-kit"].env.EXTRA, "kept");
    assert.equal(servers["yandex-kit"].env.YANDEX_KIT_TOKEN, SECRET_ONE);
    assert.deepEqual(servers["yandex-kit"].args, [
      "-y",
      "mcp-yandex-kit@latest",
    ]);
    if (format === "vscode-json") {
      assert.equal(servers["yandex-kit"].type, "stdio");
    }
    if (format === "daimon-json") {
      assert.equal(servers["yandex-kit"].transport, "stdio");
    }
    const inspected = inspectJson(merged, format);
    assert.equal(inspected.canonical, true);
    assert.equal(inspected.token, SECRET_ONE);
  }
});

test("uses the primary name when a project contains only unrelated MCP servers", async () => {
  await withTempDir(async (tempDir) => {
    const projectDir = path.join(tempDir, "project");
    const projectConfig = path.join(projectDir, ".cursor", "mcp.json");
    const userConfig = path.join(tempDir, "user", "mcp.json");
    await mkdir(path.dirname(projectConfig), { recursive: true });
    await writeFile(
      projectConfig,
      JSON.stringify({
        mcpServers: {
          github: { command: "github-mcp", args: ["serve"] },
          playwright: { command: "playwright-mcp" },
        },
      }),
    );

    const adapter = resolveAdapter({
      client: "cursor",
      configPath: userConfig,
      projectDir,
    });
    const selected = await selectManagedAdapter(adapter);
    assert.equal(selected.serverName, "yandex-kit");
  });
});

test("uses a fallback name for an exact project collision without changing either project server", async () => {
  await withTempDir(async (tempDir) => {
    const projectDir = path.join(tempDir, "project");
    const projectConfig = path.join(projectDir, ".cursor", "mcp.json");
    const userConfig = path.join(tempDir, "user", "mcp.json");
    const projectState = {
      mcpServers: {
        github: { command: "github-mcp", args: ["serve"] },
        "yandex-kit": {
          command: "project-owned-command",
          env: { PROJECT_ONLY: "kept" },
        },
      },
    };
    const userState = {
      theme: "dark",
      mcpServers: {
        slack: { command: "slack-mcp", env: { TEAM: "kept" } },
      },
    };
    await mkdir(path.dirname(projectConfig), { recursive: true });
    await mkdir(path.dirname(userConfig), { recursive: true });
    await writeFile(projectConfig, JSON.stringify(projectState, null, 2));
    await writeFile(userConfig, JSON.stringify(userState, null, 2));

    const adapter = resolveAdapter({
      client: "cursor",
      configPath: userConfig,
      projectDir,
    });
    const selected = await selectManagedAdapter(adapter);
    assert.equal(selected.serverName, FALLBACK_SERVER_NAME);
    await configureAdapter(selected, { token: SECRET_ONE });

    assert.deepEqual(
      JSON.parse(await readFile(projectConfig, "utf8")),
      projectState,
    );
    const configured = JSON.parse(await readFile(userConfig, "utf8"));
    assert.deepEqual(configured.mcpServers.slack, userState.mcpServers.slack);
    assert.equal(configured.theme, "dark");
    assert.equal(configured.mcpServers["yandex-kit"], undefined);
    assert.equal(
      configured.mcpServers[FALLBACK_SERVER_NAME].env.YANDEX_KIT_TOKEN,
      SECRET_ONE,
    );
    assert.equal(
      inspectJson(
        JSON.stringify(configured),
        "mcp-json",
        userConfig,
        FALLBACK_SERVER_NAME,
      ).canonical,
      true,
    );
  });
});

test("treats a malformed project server entry as an occupied name", async () => {
  await withTempDir(async (tempDir) => {
    const projectDir = path.join(tempDir, "project");
    const projectConfig = path.join(projectDir, ".cursor", "mcp.json");
    await mkdir(path.dirname(projectConfig), { recursive: true });
    await writeFile(
      projectConfig,
      JSON.stringify({ mcpServers: { "yandex-kit": "invalid-entry" } }),
    );

    const selected = await selectManagedAdapter(
      resolveAdapter({
        client: "cursor",
        configPath: path.join(tempDir, "user", "mcp.json"),
        projectDir,
      }),
    );

    assert.equal(selected.serverName, FALLBACK_SERVER_NAME);
  });
});

test("keeps using the managed fallback on later runs", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, "mcp.json");
    const adapter = resolveAdapter({
      client: "cursor",
      configPath,
      projectDir: tempDir,
      serverName: FALLBACK_SERVER_NAME,
    });
    await configureAdapter(adapter, { token: SECRET_ONE });

    const selected = await selectManagedAdapter(
      resolveAdapter({
        client: "cursor",
        configPath,
        projectDir: tempDir,
      }),
    );
    assert.equal(selected.serverName, FALLBACK_SERVER_NAME);
    assert.equal((await inspectAdapter(selected)).configured, true);
  });
});

test("detects a Claude local-scope collision stored in the user config", async () => {
  await withTempDir(async (tempDir) => {
    const projectDir = path.join(tempDir, "project");
    const configPath = path.join(tempDir, ".claude.json");
    const localServer = {
      command: "project-owned-command",
      env: { PROJECT_ONLY: "kept" },
    };
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          github: { command: "github-mcp" },
        },
        projects: {
          [projectDir]: {
            mcpServers: {
              "yandex-kit": localServer,
              playwright: { command: "playwright-mcp" },
            },
          },
        },
      }),
    );

    const selected = await selectManagedAdapter(
      resolveAdapter({
        client: "claude-code",
        configPath,
        projectDir,
      }),
    );
    assert.equal(selected.serverName, FALLBACK_SERVER_NAME);
    await configureAdapter(selected, { token: SECRET_ONE });

    const configured = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(
      configured.projects[projectDir].mcpServers["yandex-kit"],
      localServer,
    );
    assert.deepEqual(
      configured.projects[projectDir].mcpServers.playwright,
      { command: "playwright-mcp" },
    );
    assert.deepEqual(configured.mcpServers.github, { command: "github-mcp" });
  });
});

test("detects Kimi's documented project-level override", async () => {
  await withTempDir(async (tempDir) => {
    const projectDir = path.join(tempDir, "project");
    const projectConfig = path.join(projectDir, ".kimi-code", "mcp.json");
    const userConfig = path.join(tempDir, "user", "mcp.json");
    await mkdir(path.dirname(projectConfig), { recursive: true });
    await writeFile(
      projectConfig,
      JSON.stringify({
        mcpServers: {
          "yandex-kit": { command: "project-owned-command" },
          github: { command: "github-mcp" },
        },
      }),
    );

    const selected = await selectManagedAdapter(
      resolveAdapter({
        client: "kimi",
        configPath: userConfig,
        projectDir,
      }),
    );
    assert.equal(selected.serverName, FALLBACK_SERVER_NAME);
  });
});

test("supports the fallback name in JSON, TOML, and YAML without touching other servers", () => {
  const json = mergeJson(
    '{"mcpServers":{"other":{"command":"other"}}}',
    "mcp-json",
    SECRET_ONE,
    "<json>",
    FALLBACK_SERVER_NAME,
  );
  assert.deepEqual(JSON.parse(json).mcpServers.other, { command: "other" });
  assert.equal(
    inspectJson(json, "mcp-json", "<json>", FALLBACK_SERVER_NAME).canonical,
    true,
  );

  const toml = mergeToml(
    '[mcp_servers.other]\ncommand = "other"\n',
    SECRET_ONE,
    "<toml>",
    FALLBACK_SERVER_NAME,
  );
  assert.match(toml, /\[mcp_servers\.other\]/);
  assert.equal(
    inspectToml(toml, "<toml>", FALLBACK_SERVER_NAME).canonical,
    true,
  );

  const yaml = mergeYaml(
    'mcp_servers:\n  other:\n    command: "other"\n',
    SECRET_ONE,
    "<yaml>",
    FALLBACK_SERVER_NAME,
  );
  assert.match(yaml, /  other:/);
  assert.equal(
    inspectYaml(yaml, "<yaml>", FALLBACK_SERVER_NAME).canonical,
    true,
  );
});

test("merges Codex TOML and preserves unrelated tables and server options", () => {
  const original = [
    'model = "gpt-5"',
    "",
    '[projects."/tmp/example.with-dot"]',
    'trust_level = "trusted"',
    "",
    "[desktop.open-in-target-preferences.perPath]",
    '"/tmp/example.with-dot" = "cursor"',
    "",
    "[mcp_servers.other]",
    'command = "other"',
    "",
    "[mcp_servers.yandex-kit]",
    'command = "old"',
    'args = ["old"]',
    "startup_timeout_sec = 30",
    "",
    "[mcp_servers.yandex-kit.env]",
    'YANDEX_KIT_TOKEN = "old"',
    'EXTRA = "kept"',
    "",
  ].join("\n");
  const merged = mergeToml(original, SECRET_ONE);
  assert.match(merged, /model = "gpt-5"/);
  assert.match(merged, /\[projects\."\/tmp\/example\.with-dot"\]/);
  assert.match(merged, /"\/tmp\/example\.with-dot" = "cursor"/);
  assert.match(merged, /\[mcp_servers\.other\]/);
  assert.match(merged, /startup_timeout_sec = 30/);
  assert.match(merged, /EXTRA = "kept"/);
  assert.equal(inspectToml(merged).canonical, true);
  assert.equal(inspectToml(merged).token, SECRET_ONE);
});

test("merges Hermes YAML and preserves unrelated servers and options", () => {
  const original = [
    "theme: dark",
    "mcp_servers:",
    "  other:",
    '    command: "other"',
    "  yandex-kit:",
    '    command: "old"',
    '    args: ["old"]',
    "    timeout: 99",
    "    env:",
    '      EXTRA: "kept"',
    '      YANDEX_KIT_TOKEN: "old"',
    "logging:",
    "  level: info",
    "",
  ].join("\n");
  const merged = mergeYaml(original, SECRET_ONE);
  assert.match(merged, /theme: dark/);
  assert.match(merged, /  other:/);
  assert.match(merged, /    timeout: 99/);
  assert.match(merged, /      EXTRA: "kept"/);
  assert.match(merged, /logging:/);
  assert.equal(inspectYaml(merged).canonical, true);
  assert.equal(inspectYaml(merged).token, SECRET_ONE);
});

test("configure is idempotent, supports token replacement, and backs up changes", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, "mcp.json");
    const original = JSON.stringify({ keep: true }, null, 2) + "\n";
    await writeFile(configPath, original);
    const adapter = resolveAdapter({
      client: "cursor",
      configPath,
    });

    const first = await configureAdapter(adapter, { token: SECRET_ONE });
    assert.equal(first.changed, true);
    assert.equal(
      await readFile(`${configPath}${BACKUP_SUFFIX}`, "utf8"),
      original,
    );
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    assert.equal((await stat(first.backupPath)).mode & 0o777, 0o600);

    const repeated = await configureAdapter(adapter, { token: SECRET_ONE });
    assert.equal(repeated.changed, false);
    assert.equal(inspectJson(await readFile(configPath, "utf8"), "mcp-json").token, SECRET_ONE);

    const replacement = await configureAdapter(adapter, { token: SECRET_TWO });
    assert.equal(replacement.changed, true);
    assert.equal(inspectJson(await readFile(configPath, "utf8"), "mcp-json").token, SECRET_TWO);

    await rollbackChange({
      configPath,
      backupPath: replacement.backupPath,
      backupHash: replacement.backupHash,
      created: false,
      expectedHash: replacement.configHash,
    });
    assert.equal(inspectJson(await readFile(configPath, "utf8"), "mcp-json").token, SECRET_ONE);
  });
});

test("malformed foreign config stays byte-for-byte unchanged", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, "mcp.json");
    const broken = '{ "mcpServers": ';
    await writeFile(configPath, broken);
    const adapter = resolveAdapter({ client: "cursor", configPath });
    await assert.rejects(
      configureAdapter(adapter, { token: SECRET_ONE }),
      (error) => error instanceof SetupError && error.code === "MALFORMED_CONFIG",
    );
    assert.equal(await readFile(configPath, "utf8"), broken);
  });
});

test("malformed TOML and YAML stay byte-for-byte unchanged", async () => {
  await withTempDir(async (tempDir) => {
    const cases = [
      ["codex", "config.toml", "[mcp_servers.yandex-kit\n"],
      ["codex", "unfinished.toml", "model = [\n"],
      [
        "codex",
        "inline-env.toml",
        [
          "[mcp_servers.yandex-kit]",
          'env = { YANDEX_KIT_TOKEN = "old", EXTRA = "kept" }',
          "",
        ].join("\n"),
      ],
      ["hermes", "config.yaml", "mcp_servers:\n\tyandex-kit:\n"],
      ["hermes", "unfinished.yaml", "theme: [\n"],
      ["hermes", "flow.yaml", "mcp_servers: {}\n"],
    ];
    for (const [client, filename, broken] of cases) {
      const configPath = path.join(tempDir, filename);
      await writeFile(configPath, broken);
      const adapter = resolveAdapter({ client, configPath });
      await assert.rejects(
        configureAdapter(adapter, { token: SECRET_ONE }),
        (error) =>
          error instanceof SetupError && error.code === "MALFORMED_CONFIG",
      );
      assert.equal(await readFile(configPath, "utf8"), broken);
    }
  });
});

test("rollback removes only a config created by the current setup run", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, "new", "mcp.json");
    const adapter = resolveAdapter({ client: "cursor", configPath });
    const configured = await configureAdapter(adapter, { token: SECRET_ONE });
    assert.equal(configured.created, true);
    assert.equal(configured.backupPath, null);
    await rollbackChange({
      configPath,
      created: true,
      expectedHash: configured.configHash,
    });
    await assert.rejects(readFile(configPath, "utf8"), { code: "ENOENT" });
  });
});

test("rollback refuses to overwrite a config changed after setup", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, "mcp.json");
    await writeFile(configPath, '{"keep":true}\n');
    const adapter = resolveAdapter({ client: "cursor", configPath });
    const configured = await configureAdapter(adapter, { token: SECRET_ONE });
    const configuredContent = await readFile(configPath, "utf8");
    const changedAfterSetup = '{"changedAfterSetup":true}\n';
    await writeFile(configPath, changedAfterSetup);

    await assert.rejects(
      rollbackChange({
        configPath,
        backupPath: configured.backupPath,
        backupHash: configured.backupHash,
        created: false,
        expectedHash: configured.configHash,
      }),
      (error) =>
        error instanceof SetupError && error.code === "ROLLBACK_CONFLICT",
    );
    assert.equal(await readFile(configPath, "utf8"), changedAfterSetup);

    await writeFile(configPath, configuredContent);
    await writeFile(configured.backupPath, '{"tampered":true}\n');
    await assert.rejects(
      rollbackChange({
        configPath,
        backupPath: configured.backupPath,
        backupHash: configured.backupHash,
        created: false,
        expectedHash: configured.configHash,
      }),
      (error) =>
        error instanceof SetupError && error.code === "ROLLBACK_CONFLICT",
    );
    assert.equal(await readFile(configPath, "utf8"), configuredContent);
  });
});

test("Windows command shims run through cmd.exe without a Node shell", () => {
  assert.deepEqual(
    buildSpawnInvocation("npx", ["-y", "mcp-yandex-kit@latest"], {
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      windowsShim: true,
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npx", "-y", "mcp-yandex-kit@latest"],
    },
  );
  assert.deepEqual(
    buildSpawnInvocation("npx", ["--version"], {
      platform: "linux",
      windowsShim: true,
    }),
    { command: "npx", args: ["--version"] },
  );
});

test("Kimi clients and Hermes use a structural client check plus direct smoke", async () => {
  await withTempDir(async (tempDir) => {
    for (const [client, filename] of [
      ["kimi", "mcp.json"],
      ["kimi-desktop", "config.json"],
      ["hermes", "config.yaml"],
    ]) {
      const configPath = path.join(tempDir, client, filename);
      const adapter = resolveAdapter({ client, configPath });
      await configureAdapter(adapter, { token: SECRET_ONE });
      const result = await clientCheck(adapter);
      assert.equal(result.ok, true);
      assert.equal(result.mode, "structural");
    }
  });
});

test("Claude client check verifies the effective server definition, not only its name", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, ".claude.json");
    const adapter = resolveAdapter({
      client: "claude-code",
      configPath,
      projectDir: tempDir,
      serverName: FALLBACK_SERVER_NAME,
    });
    await configureAdapter(adapter, { token: SECRET_ONE });

    const calls = [];
    const result = await clientCheck(adapter, {
      run: async (command, args) => {
        calls.push([command, args]);
        return {
          available: true,
          code: 0,
          stdout: [
            `Name: ${FALLBACK_SERVER_NAME}`,
            "Command: npx",
            "Args: -y mcp-yandex-kit@latest",
          ].join("\n"),
          stderr: "",
        };
      },
    });
    assert.deepEqual(calls, [
      ["claude", ["mcp", "get", FALLBACK_SERVER_NAME]],
    ]);
    assert.equal(result.serverName, FALLBACK_SERVER_NAME);

    await assert.rejects(
      clientCheck(adapter, {
        run: async () => ({
          available: true,
          code: 0,
          stdout: [
            `Name: ${FALLBACK_SERVER_NAME}`,
            "Command: another-command",
          ].join("\n"),
          stderr: "",
        }),
      }),
      (error) =>
        error instanceof SetupError && error.code === "SERVER_SHADOWED",
    );
  });
});

test("CLI automatically configures the fallback on an exact project collision", async () => {
  await withTempDir(async (tempDir) => {
    const projectDir = path.join(tempDir, "project");
    const projectConfig = path.join(projectDir, ".vscode", "mcp.json");
    const userConfig = path.join(tempDir, "user", "mcp.json");
    await mkdir(path.dirname(projectConfig), { recursive: true });
    await writeFile(
      projectConfig,
      JSON.stringify({
        servers: {
          "yandex-kit": { command: "project-owned-command" },
          github: { command: "github-mcp" },
        },
      }),
    );

    const result = await runCli(
      [
        "configure",
        "--client",
        "vscode",
        "--config",
        userConfig,
        "--project-dir",
        projectDir,
        "--token-stdin",
        "--json",
      ],
      `${SECRET_ONE}\n`,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).serverName, FALLBACK_SERVER_NAME);
    const user = JSON.parse(await readFile(userConfig, "utf8"));
    assert.equal(user.servers["yandex-kit"], undefined);
    assert.equal(
      user.servers[FALLBACK_SERVER_NAME].env.YANDEX_KIT_TOKEN,
      SECRET_ONE,
    );
    assert.deepEqual(
      JSON.parse(await readFile(projectConfig, "utf8")).servers.github,
      { command: "github-mcp" },
    );
  });
});

test("CLI receives token through stdin and never prints it", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, "mcp.json");
    const unavailable = await runCli(
      [
        "configure",
        "--client",
        "cursor",
        "--config",
        configPath,
        "--token-stdin",
        "--json",
      ],
      `${SECRET_ONE}\n`,
      { env: { ...process.env, PATH: tempDir } },
    );
    assert.equal(unavailable.code, 1);
    assert.match(unavailable.stderr, /"code":"NPX_UNAVAILABLE"/);
    await assert.rejects(readFile(configPath, "utf8"), { code: "ENOENT" });

    const obsoleteRepair = await runCli([
      "configure",
      "--client",
      "cursor",
      "--config",
      configPath,
      "--keep-token",
      "--json",
    ]);
    assert.equal(obsoleteRepair.code, 1);
    await assert.rejects(readFile(configPath, "utf8"), { code: "ENOENT" });

    const result = await runCli(
      [
        "configure",
        "--client",
        "cursor",
        "--config",
        configPath,
        "--token-stdin",
        "--json",
      ],
      `${SECRET_ONE}\n`,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.includes(SECRET_ONE), false);
    assert.equal(result.stderr.includes(SECRET_ONE), false);
    assert.equal(
      inspectJson(await readFile(configPath, "utf8"), "mcp-json").token,
      SECRET_ONE,
    );
  });
});

test("dynamic native CLI receives the token in argv without exposing it", async () => {
  const successArgs = [
    "-e",
    [
      'const value = process.argv[1] || "";',
      'process.stdout.write(value);',
      'if (!value.startsWith("--token=y0_")) process.exit(9);',
    ].join(""),
    "--",
    `--token=${TOKEN_PLACEHOLDER}`,
  ];
  const success = await runCli(
    [
      "native-configure",
      "--command",
      process.execPath,
      "--args-json",
      JSON.stringify(successArgs),
      "--token-stdin",
      "--server-name",
      FALLBACK_SERVER_NAME,
      "--json",
    ],
    `${SECRET_ONE}\n`,
  );
  assert.equal(success.code, 0, success.stderr);
  assert.equal(success.stdout.includes(SECRET_ONE), false);
  assert.equal(success.stderr.includes(SECRET_ONE), false);
  assert.deepEqual(JSON.parse(success.stdout), {
    configured: true,
    mode: "native-cli",
    command: process.execPath,
    serverName: FALLBACK_SERVER_NAME,
  });

  const failureArgs = [
    "-e",
    'process.stderr.write(process.argv[1] || "");process.exit(7);',
    "--",
    `--token=${TOKEN_PLACEHOLDER}`,
  ];
  const failure = await runCli(
    [
      "native-configure",
      "--command",
      process.execPath,
      "--args-json",
      JSON.stringify(failureArgs),
      "--token-stdin",
      "--json",
    ],
    `${SECRET_ONE}\n`,
  );
  assert.equal(failure.code, 1);
  assert.equal(failure.stdout.includes(SECRET_ONE), false);
  assert.equal(failure.stderr.includes(SECRET_ONE), false);
  assert.match(failure.stderr, /\[redacted\]/);
  assert.match(failure.stderr, /"code":"NATIVE_CONFIGURE_FAILED"/);
});

test("direct smoke performs initialize, tools/list, and read-only get_store", async () => {
  const result = await smokeMcp({
    token: SECRET_ONE,
    command: process.execPath,
    args: [fakeServer],
    timeoutMs: 5_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.toolCount, 1);
  assert.deepEqual(result.store, {
    id: "store-1",
    slug: "test-store",
    name: null,
    url: "https://test.example",
  });
  assert.ok(Number.isInteger(result.elapsedMs) && result.elapsedMs >= 0);
  assert.equal(JSON.stringify(result).includes(SECRET_ONE), false);
});

test("token stdin treats the first newline as the terminator, not EOF", async () => {
  const open = new PassThrough();
  open.write(`${SECRET_ONE}\n`);
  assert.equal(await readTokenStdin(open), SECRET_ONE);

  const carriage = new PassThrough();
  carriage.write(`${SECRET_ONE}\r\n`);
  assert.equal(await readTokenStdin(carriage), SECRET_ONE);

  const eofOnly = new PassThrough();
  eofOnly.end(SECRET_ONE);
  assert.equal(await readTokenStdin(eofOnly), SECRET_ONE);

  const empty = new PassThrough();
  empty.write("\n");
  await assert.rejects(
    readTokenStdin(empty),
    (error) => error instanceof SetupError && error.code === "TOKEN_REQUIRED",
  );

  const multiline = new PassThrough();
  multiline.write(`${SECRET_ONE}\n${SECRET_TWO}\n`);
  await assert.rejects(
    readTokenStdin(multiline),
    (error) => error instanceof SetupError && error.code === "TOKEN_REQUIRED",
  );
});

test(
  "CLI configure completes while stdin stays open after the token line",
  { timeout: 30_000 },
  async () => {
    await withTempDir(async (tempDir) => {
      const configPath = path.join(tempDir, "mcp.json");
      const result = await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            setupScript,
            "configure",
            "--client",
            "cursor",
            "--config",
            configPath,
            "--token-stdin",
            "--json",
          ],
          { stdio: ["pipe", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        child.stdin.on("error", () => {});
        child.stdin.write(`${SECRET_ONE}\n`);
      });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout.includes(SECRET_ONE), false);
      assert.equal(
        inspectJson(await readFile(configPath, "utf8"), "mcp-json").token,
        SECRET_ONE,
      );
    });
  },
);

test("network probe connects locally and reports NETWORK_UNAVAILABLE fast", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    assert.deepEqual(
      await probeNetwork({
        targets: [{ host: "127.0.0.1", port }],
        timeoutMs: 2_000,
      }),
      { networkOk: true },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const startedAt = Date.now();
  await assert.rejects(
    probeNetwork({ targets: [{ host: "127.0.0.1", port }], timeoutMs: 2_000 }),
    (error) =>
      error instanceof SetupError && error.code === "NETWORK_UNAVAILABLE",
  );
  assert.ok(Date.now() - startedAt < 3_000);
});

test("direct smoke fails fast without spawning when the network probe fails", async () => {
  await withTempDir(async (tempDir) => {
    const pidFile = path.join(tempDir, "server.pid");
    await withEnv({ FAKE_MCP_PID_FILE: pidFile }, async () => {
      const startedAt = Date.now();
      await assert.rejects(
        smokeMcp({
          token: SECRET_ONE,
          command: process.execPath,
          args: [fakeServer],
          timeoutMs: 30_000,
          probe: async () => {
            throw new SetupError("blocked", "NETWORK_UNAVAILABLE");
          },
        }),
        (error) =>
          error instanceof SetupError &&
          error.code === "NETWORK_UNAVAILABLE" &&
          !error.message.includes(SECRET_ONE),
      );
      assert.ok(Date.now() - startedAt < 5_000);
      await assert.rejects(readFile(pidFile, "utf8"), { code: "ENOENT" });
    });
  });
});

test("direct smoke enforces one wall-clock budget across all MCP steps", async () => {
  await withEnv({ FAKE_MCP_DELAY_MS: "700" }, async () => {
    const startedAt = Date.now();
    await assert.rejects(
      smokeMcp({
        token: SECRET_ONE,
        command: process.execPath,
        args: [fakeServer],
        timeoutMs: 1_500,
      }),
      (error) =>
        error instanceof SetupError &&
        error.code === "SMOKE_TIMEOUT" &&
        !error.message.includes(SECRET_ONE),
    );
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 1_400, `rejected too early: ${elapsed}ms`);
    assert.ok(elapsed < 3_000, `budget did not cap the run: ${elapsed}ms`);
  });
});

test("direct smoke kills the MCP child after the deadline", async () => {
  await withTempDir(async (tempDir) => {
    const pidFile = path.join(tempDir, "server.pid");
    await withEnv(
      { FAKE_MCP_PID_FILE: pidFile, FAKE_MCP_DELAY_MS: "60000" },
      async () => {
        await assert.rejects(
          smokeMcp({
            token: SECRET_ONE,
            command: process.execPath,
            args: [fakeServer],
            timeoutMs: 1_000,
          }),
          (error) =>
            error instanceof SetupError && error.code === "SMOKE_TIMEOUT",
        );
        const pid = Number(await readFile(pidFile, "utf8"));
        assert.ok(Number.isInteger(pid) && pid > 0);
        await waitFor(() => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        });
      },
    );
  });
});

test("direct smoke reports an authentication failure as SMOKE_AUTH", async () => {
  await withEnv({ FAKE_MCP_AUTH_STATUS: "401" }, async () => {
    await assert.rejects(
      smokeMcp({
        token: SECRET_ONE,
        command: process.execPath,
        args: [fakeServer],
        timeoutMs: 5_000,
      }),
      (error) =>
        error instanceof SetupError &&
        error.code === "SMOKE_AUTH" &&
        !error.message.includes(SECRET_ONE),
    );
  });
});
