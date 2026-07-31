import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BACKUP_SUFFIX,
  TOKEN_PLACEHOLDER,
  SetupError,
  assertNode20,
  buildSpawnInvocation,
  checkPrerequisites,
  clientCheck,
  configureAdapter,
  defaultConfigPath,
  inspectJson,
  inspectToml,
  inspectYaml,
  mergeJson,
  mergeToml,
  mergeYaml,
  resolveAdapter,
  rollbackChange,
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

test("resolves user-level paths for all eight tested clients", () => {
  const home = "/users/test";
  const env = {
    APPDATA: "C:\\Users\\test\\AppData\\Roaming",
    CODEX_HOME: "/custom/codex",
    KIMI_CODE_HOME: "/custom/kimi",
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

test("merges every JSON capability and preserves unrelated settings", () => {
  for (const format of ["mcp-json", "vscode-json", "openclaw-json"]) {
    const root =
      format === "openclaw-json"
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
      format === "openclaw-json"
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
    const inspected = inspectJson(merged, format);
    assert.equal(inspected.canonical, true);
    assert.equal(inspected.token, SECRET_ONE);
  }
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

test("Kimi and Hermes use a structural client check plus direct smoke", async () => {
  await withTempDir(async (tempDir) => {
    for (const [client, filename] of [
      ["kimi", "mcp.json"],
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

test("skill validates candidate tokens before configuration without a retry limit", async () => {
  const skill = await readFile(path.join(scriptDir, "..", "SKILL.md"), "utf8");
  assert.ok(skill.indexOf("smoke-token --token-stdin") < skill.indexOf("## 4."));
  assert.match(skill, /Do not impose a retry limit\./);
  assert.doesNotMatch(skill, /replacement token once/);
  assert.match(
    skill,
    /Принято! Оставляем действующий токен Яндекс KIT без изменений\. Всё работает в прежнем режиме\./,
  );
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
  assert.equal(JSON.stringify(result).includes(SECRET_ONE), false);
});
