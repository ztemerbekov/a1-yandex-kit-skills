import AjvImport, {
  Ajv2020 as Ajv2020Named,
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PLUGIN_SCHEMA_URL = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA_URL = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;
const SHELL_DEFAULT_EXPANSION_PATTERN = /\$\{[^}]*:-/u;
const SECRET_NAME_PATTERN = /(?:token|secret|password|passwd|api[_-]?key|private[_-]?key)/iu;
const AjvClass: typeof Ajv2020Named =
  Ajv2020Named ??
  (AjvImport as unknown as { default?: typeof Ajv2020Named }).default ??
  (AjvImport as unknown as typeof Ajv2020Named);

function isRegularFile(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

export interface PortablePluginValidationResult {
  pluginName: string;
  pluginVersion: string;
  mcpServerNames: string[];
  skillNames: string[];
}

export interface PortablePluginValidationIssue {
  code: string;
  path: string;
}

export class PortablePluginValidationError extends Error {
  readonly issues: readonly PortablePluginValidationIssue[];

  constructor(issues: readonly PortablePluginValidationIssue[]) {
    super(
      `Agent Plugins validation failed:\n${issues
        .map((issue) => `- ${issue.path}: ${issue.code}`)
        .join("\n")}`,
    );
    this.name = "PortablePluginValidationError";
    this.issues = issues;
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new PortablePluginValidationError([
      { code: "invalid-json", path: relative(REPOSITORY_ROOT, path) },
    ]);
  }
}

function formatAjvErrors(
  relativePath: string,
  errors: ErrorObject[] | null | undefined,
): PortablePluginValidationIssue[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath || "/";
    return { code: `schema-${error.keyword}`, path: `${relativePath}${location}` };
  });
}

function validateSchema(
  path: string,
  value: unknown,
  validate: ValidateFunction,
): void {
  if (!validate(value)) {
    throw new PortablePluginValidationError(
      formatAjvErrors(relative(REPOSITORY_ROOT, path), validate.errors),
    );
  }
}

function addIssue(
  issues: PortablePluginValidationIssue[],
  code: string,
  path: string,
): void {
  issues.push({ code, path });
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${requirePathSeparator()}`));
}

function requirePathSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function assertNoSymlinkEscape(
  root: string,
  path: string,
  issues: PortablePluginValidationIssue[],
): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    let target: string;
    try {
      target = realpathSync(path);
    } catch {
      addIssue(issues, "broken-symlink", relative(REPOSITORY_ROOT, path));
      return;
    }
    if (!isWithin(root, target)) {
      addIssue(issues, "symlink-escapes-root", relative(REPOSITORY_ROOT, path));
    }
    return;
  }
  if (!stat.isDirectory()) return;

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    assertNoSymlinkEscape(root, join(path, entry.name), issues);
  }
}

function parseSkillName(skillPath: string): string | null {
  const content = readFileSync(join(skillPath, "SKILL.md"), "utf8");
  const lines = content.split(/\r?\n/u);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  const nameLine = lines.slice(1, end).find((line) => /^name:\s*/u.test(line));
  const value = nameLine?.replace(/^name:\s*/u, "").trim().replace(/^['"]|['"]$/gu, "");
  return value || null;
}

function discoverSkills(root: string, issues: PortablePluginValidationIssue[]): string[] {
  const skillsRoot = join(root, "skills");
  if (!lstatSync(skillsRoot).isDirectory()) {
    addIssue(issues, "skills-not-directory", "skills");
    return [];
  }

  const skillNames: string[] = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const skillDirectory = join(skillsRoot, entry.name);
    const skillFile = join(skillDirectory, "SKILL.md");
    if (!lstatSync(skillFile, { throwIfNoEntry: false })?.isFile()) continue;

    if (!SKILL_NAME_PATTERN.test(entry.name)) {
      addIssue(issues, "invalid-skill-name", `skills/${entry.name}`);
    }
    const skillName = parseSkillName(skillDirectory);
    if (skillName !== entry.name) {
      addIssue(issues, "skill-name-mismatch", `skills/${entry.name}/SKILL.md`);
    }
    skillNames.push(entry.name);
  }
  return skillNames.sort();
}

function inspectMcpValues(
  value: unknown,
  path: string,
  issues: PortablePluginValidationIssue[],
): void {
  if (typeof value === "string") {
    if (SHELL_DEFAULT_EXPANSION_PATTERN.test(value)) {
      addIssue(issues, "non-portable-shell-expansion", path);
    }
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if ((key === "env" || key === "headers") && child && typeof child === "object") {
      for (const [name, configuredValue] of Object.entries(child)) {
        if (SECRET_NAME_PATTERN.test(name)) {
          addIssue(issues, "portable-secret-name", `${childPath}.${name}`);
        }
        inspectMcpValues(configuredValue, `${childPath}.${name}`, issues);
      }
      continue;
    }
    inspectMcpValues(child, childPath, issues);
  }
}

function validateHostManifestVersions(
  root: string,
  plugin: Record<string, unknown>,
  issues: PortablePluginValidationIssue[],
): void {
  for (const relativePath of [".codex-plugin/plugin.json", ".cursor-plugin/plugin.json"]) {
    const path = join(root, relativePath);
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) continue;
    const hostManifest = readJson(path);
    if (!hostManifest || typeof hostManifest !== "object") continue;
    const host = hostManifest as Record<string, unknown>;
    if (host.name !== plugin.name) addIssue(issues, "host-name-mismatch", relativePath);
    if (host.version !== plugin.version) addIssue(issues, "host-version-mismatch", relativePath);
  }
}

function validateGeneratedSkillVersion(
  root: string,
  plugin: Record<string, unknown>,
  issues: PortablePluginValidationIssue[],
): void {
  const path = join(root, "packages/codegen/src/gen-skills.ts");
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return;
  const source = readFileSync(path, "utf8");
  const match = source.match(/const SKILL_VERSION = ["']([^"']+)["']/u);
  if (!match) {
    addIssue(issues, "skill-version-missing", "packages/codegen/src/gen-skills.ts");
    return;
  }
  if (match[1] !== plugin.version) {
    addIssue(issues, "skill-version-mismatch", "packages/codegen/src/gen-skills.ts");
  }
}

export function validatePortableAgentPlugin(root = REPOSITORY_ROOT): PortablePluginValidationResult {
  const pluginRoot = resolve(root);
  const pluginPath = join(pluginRoot, "plugin.json");
  const mcpPath = join(pluginRoot, "mcp.json");
  const issues: PortablePluginValidationIssue[] = [];

  for (const path of [pluginPath, mcpPath]) {
    if (!isRegularFile(path)) {
      addIssue(issues, "required-file-missing", relative(REPOSITORY_ROOT, path));
    }
  }
  if (issues.length > 0) throw new PortablePluginValidationError(issues);

  const plugin = readJson(pluginPath);
  const mcp = readJson(mcpPath);
  const ajv = new AjvClass({ allErrors: true, strict: true });
  const schemaRoot = join(REPOSITORY_ROOT, "specs/agent-plugins/1.0.0");
  const pluginSchema = readJson(join(schemaRoot, "plugin.schema.json")) as AnySchema;
  const mcpSchema = readJson(join(schemaRoot, "mcp.schema.json")) as AnySchema;
  const validatePlugin = ajv.compile(pluginSchema);
  const validateMcp = ajv.compile(mcpSchema);

  validateSchema(pluginPath, plugin, validatePlugin);
  validateSchema(mcpPath, mcp, validateMcp);

  const pluginRecord = plugin as Record<string, unknown>;
  const mcpRecord = mcp as Record<string, unknown>;
  if (pluginRecord.$schema !== PLUGIN_SCHEMA_URL) {
    addIssue(issues, "plugin-schema-mismatch", "plugin.json.$schema");
  }
  if (mcpRecord.$schema !== MCP_SCHEMA_URL) {
    addIssue(issues, "mcp-schema-mismatch", "mcp.json.$schema");
  }
  if (!pluginRecord.name || typeof pluginRecord.name !== "string") {
    addIssue(issues, "plugin-name-missing", "plugin.json.name");
  }
  if (!pluginRecord.version || typeof pluginRecord.version !== "string") {
    addIssue(issues, "plugin-version-missing", "plugin.json.version");
  }
  inspectMcpValues(mcp, "mcp.json", issues);
  validateHostManifestVersions(pluginRoot, pluginRecord, issues);
  validateGeneratedSkillVersion(pluginRoot, pluginRecord, issues);

  const skills = discoverSkills(pluginRoot, issues);
  const containmentRoot = realpathSync(pluginRoot);
  assertNoSymlinkEscape(containmentRoot, pluginPath, issues);
  assertNoSymlinkEscape(containmentRoot, mcpPath, issues);
  assertNoSymlinkEscape(containmentRoot, join(pluginRoot, "skills"), issues);
  if (issues.length > 0) throw new PortablePluginValidationError(issues);

  const servers = mcpRecord.mcpServers as Record<string, unknown>;
  return {
    pluginName: pluginRecord.name as string,
    pluginVersion: pluginRecord.version as string,
    mcpServerNames: Object.keys(servers).sort(),
    skillNames: skills,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = validatePortableAgentPlugin();
    console.log(
      JSON.stringify(
        {
          ok: true,
          plugin: result.pluginName,
          version: result.pluginVersion,
          skills: result.skillNames,
          mcpServers: result.mcpServerNames,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
