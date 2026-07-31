import { SetupError } from "../shared.mjs";
import { inspectJson, mergeJson } from "./json.mjs";
import { inspectToml, mergeToml } from "./toml.mjs";
import { inspectYaml, mergeYaml } from "./yaml.mjs";

export const CONFIG_FORMATS = new Map([
  [
    "mcp-json",
    {
      inspect: (content, configPath, serverName) =>
        inspectJson(content, "mcp-json", configPath, serverName),
      merge: (content, token, configPath, serverName) =>
        mergeJson(content, "mcp-json", token, configPath, serverName),
    },
  ],
  [
    "vscode-json",
    {
      inspect: (content, configPath, serverName) =>
        inspectJson(content, "vscode-json", configPath, serverName),
      merge: (content, token, configPath, serverName) =>
        mergeJson(content, "vscode-json", token, configPath, serverName),
    },
  ],
  [
    "openclaw-json",
    {
      inspect: (content, configPath, serverName) =>
        inspectJson(content, "openclaw-json", configPath, serverName),
      merge: (content, token, configPath, serverName) =>
        mergeJson(content, "openclaw-json", token, configPath, serverName),
    },
  ],
  [
    "codex-toml",
    {
      inspect: inspectToml,
      merge: mergeToml,
    },
  ],
  [
    "hermes-yaml",
    {
      inspect: inspectYaml,
      merge: mergeYaml,
    },
  ],
]);

export function hasConfigFormat(format) {
  return CONFIG_FORMATS.has(format);
}

function configFormat(format) {
  const adapter = CONFIG_FORMATS.get(format);
  if (!adapter) {
    throw new SetupError(
      `Unsupported capability "${format}".`,
      "UNSUPPORTED_FORMAT",
    );
  }
  return adapter;
}

export function inspectConfig(content, format, configPath, serverName) {
  return configFormat(format).inspect(content, configPath, serverName);
}

export function mergeConfig(content, format, token, configPath, serverName) {
  return configFormat(format).merge(content, token, configPath, serverName);
}

export { inspectJson, mergeJson } from "./json.mjs";
export { inspectToml, mergeToml } from "./toml.mjs";
export { inspectYaml, mergeYaml } from "./yaml.mjs";
