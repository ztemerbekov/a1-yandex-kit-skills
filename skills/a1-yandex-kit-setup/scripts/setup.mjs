#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  SetupError,
  configureApprovalPolicy,
  assertNode20,
  checkPrerequisites,
  clientCheck,
  configureAdapter,
  configureNative,
  inspectAdapter,
  inspectApprovalPolicy,
  normalizeClient,
  resolveAdapter,
  rollbackChange,
  selectManagedAdapter,
  smokeAdapter,
  smokeMcp,
} from "./setup-lib.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) {
      throw new SetupError(`Unexpected argument "${item}".`, "USAGE");
    }
    const key = item.slice(2);
    if (["json", "token-stdin", "created"].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new SetupError(`Missing value for --${key}.`, "USAGE");
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function adapterFrom(options) {
  if (!options.client) {
    throw new SetupError("--client is required.", "USAGE");
  }
  return resolveAdapter({
    client: options.client,
    format: options.format,
    configPath: options.config,
    serverName: options["server-name"],
    projectDir: options["project-dir"],
  });
}

// The first newline terminates the token, so an interactive caller may keep
// the stdin pipe open — the helper must never block on a distant EOF.
export async function readTokenStdin(stream = process.stdin) {
  let value = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    value += chunk;
    if (value.includes("\n")) break;
  }
  const newline = value.indexOf("\n");
  const rest = newline === -1 ? "" : value.slice(newline + 1);
  const token = (newline === -1 ? value : value.slice(0, newline)).trim();
  if (!token) {
    throw new SetupError("A Yandex KIT token is required on stdin.", "TOKEN_REQUIRED");
  }
  if (rest.trim() || /\r/.test(token)) {
    throw new SetupError(
      "Send exactly one Yandex KIT token on stdin.",
      "TOKEN_REQUIRED",
    );
  }
  return token;
}

function publicStatus(state) {
  const { token: _token, ...safe } = state;
  return safe;
}

function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  for (const [key, value] of Object.entries(result)) {
    if (value !== null && value !== undefined) {
      process.stdout.write(`${key}: ${String(value)}\n`);
    }
  }
}

function usage() {
  return [
    "Usage:",
    "  setup.mjs preflight [--json]",
    "  setup.mjs status --client <id> [--format <capability> --config <path> --project-dir <path>] [--json]",
    "  setup.mjs configure --client <id> --token-stdin [--format <capability> --config <path> --project-dir <path> --server-name <name>] [--json]",
    "  setup.mjs native-configure --command <executable> --args-json <json-array-with-{{YANDEX_KIT_TOKEN}}> --token-stdin [--server-name <name>] [--json]",
    "  setup.mjs client-check --client <id> [--format <capability> --config <path> --project-dir <path> --server-name <name>] [--json]",
    "  setup.mjs smoke --client <id> [--format <capability> --config <path> --project-dir <path> --server-name <name>] [--json]",
    "  setup.mjs smoke-token --token-stdin [--json]",
    "  setup.mjs approval-status --client <id> [--config <path> --server-name <name> --effective-server-id <id> --cursor-schema <path>] [--json]",
    "  setup.mjs approval-configure --client <id> [--config <path> --server-name <name> --effective-server-id <id> --cursor-schema <path>] [--json]",
    "  setup.mjs rollback --config <path> --expected-hash <configHash> (--backup <path> --backup-hash <backupHash>|--created) [--json]",
    "",
    "Capabilities: mcp-json, vscode-json, codex-toml, hermes-yaml, openclaw-json",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  assertNode20();
  const { command, options } = parseArgs(argv);
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === "preflight") {
    printResult(await checkPrerequisites(), options.json);
    return;
  }

  if (command === "rollback") {
    if (!options.config) {
      throw new SetupError("--config is required for rollback.", "USAGE");
    }
    const result = await rollbackChange({
      configPath: options.config,
      backupPath: options.backup,
      backupHash: options["backup-hash"],
      created: Boolean(options.created),
      expectedHash: options["expected-hash"],
    });
    printResult(result, options.json);
    return;
  }

  if (command === "native-configure") {
    if (!options.command || !options["args-json"] || !options["token-stdin"]) {
      throw new SetupError(
        "Native configuration requires --command, --args-json and --token-stdin.",
        "USAGE",
      );
    }
    let argsTemplate;
    try {
      argsTemplate = JSON.parse(options["args-json"]);
    } catch {
      throw new SetupError(
        "--args-json must be a JSON array of strings.",
        "INVALID_NATIVE_ARGUMENTS",
      );
    }
    await checkPrerequisites();
    const token = await readTokenStdin();
    printResult(
      await configureNative({
        command: options.command,
        argsTemplate,
        token,
        serverName: options["server-name"],
      }),
      options.json,
    );
    return;
  }

  if (command === "smoke-token") {
    if (!options["token-stdin"]) {
      throw new SetupError(
        "Direct token smoke requires --token-stdin.",
        "USAGE",
      );
    }
    await checkPrerequisites();
    const token = await readTokenStdin();
    printResult(await smokeMcp({ token }), options.json);
    return;
  }

  if (command === "approval-status" || command === "approval-configure") {
    if (!options.client) {
      throw new SetupError("--client is required.", "USAGE");
    }
    const policyOptions = {
      client: normalizeClient(options.client),
      configPath: options.config,
      serverName: options["server-name"],
      effectiveServerId: options["effective-server-id"],
      cursorSchemaPath: options["cursor-schema"],
    };
    const result = command === "approval-status"
      ? await inspectApprovalPolicy(policyOptions)
      : await configureApprovalPolicy(policyOptions);
    printResult(result, options.json);
    return;
  }

  const adapter = await selectManagedAdapter(adapterFrom(options));
  if (command === "status") {
    const prerequisites = await checkPrerequisites();
    const state = publicStatus(await inspectAdapter(adapter));
    printResult({ ...prerequisites, ...state }, options.json);
    return;
  }
  if (command === "configure") {
    if (!options["token-stdin"]) {
      throw new SetupError(
        "Configuration requires --token-stdin.",
        "USAGE",
      );
    }
    await checkPrerequisites();
    const token = await readTokenStdin();
    const result = await configureAdapter(adapter, { token });
    printResult(result, options.json);
    return;
  }
  if (command === "client-check") {
    printResult(await clientCheck(adapter), options.json);
    return;
  }
  if (command === "smoke") {
    printResult(await smokeAdapter(adapter), options.json);
    return;
  }
  throw new SetupError(`Unknown command "${command}".\n${usage()}`, "USAGE");
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    const code = error instanceof SetupError ? error.code : "UNEXPECTED";
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exitCode = 1;
  });
}
