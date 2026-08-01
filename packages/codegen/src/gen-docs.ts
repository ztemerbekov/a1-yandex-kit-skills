/**
 * Generates docs/TOOLS.md from the MCP server sources:
 *  1. imports every register*Tools() from packages/mcp/src/tools/*.ts (tsx transpiles
 *     the TS imports) and records tool names/descriptions via a fake server;
 *  2. computes curated operation coverage by scanning the same sources for
 *     client operation-id literals (call/listAll/validateRequestBody sites and
 *     action-map values), validated against the generated operation registry.
 *
 * Run: npm run gen (repo root) or tsx src/gen-docs.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOLS_DIR = fileURLToPath(new URL("../../mcp/src/tools/", import.meta.url));
const MCP_PKG_PATH = fileURLToPath(new URL("../../mcp/package.json", import.meta.url));
const REGISTRY_PATH = fileURLToPath(
  new URL("../../core/src/generated/registry.json", import.meta.url),
);
const OUT_DIR = fileURLToPath(new URL("../../../docs/", import.meta.url));

/** Human-readable section titles per tool file (fallback: capitalized basename). */
const SECTION_TITLES: Record<string, string> = {
  categories: "Categories",
  collections: "Collections",
  customers: "Customers",
  discounts: "Discounts",
  files: "Files",
  giftcards: "Gift cards",
  meta: "Meta (operation catalog & escape hatch)",
  orders: "Orders",
  products: "Products",
  promocodes: "Promo codes",
  store: "Store",
  variants: "Variants",
  warehouses: "Warehouses",
  webhooks: "Webhooks",
};

interface RecordedTool {
  name: string;
  description: string;
  readOnly: boolean;
}

interface ToolSection {
  file: string;
  title: string;
  tools: RecordedTool[];
}

interface RegistryOp {
  id: string;
  method: string;
  path: string;
  tag: string;
  summaryRu: string;
}

const registry: { opsCount: number; ops: Record<string, RegistryOp> } = JSON.parse(
  readFileSync(REGISTRY_PATH, "utf8"),
);
const serverName: string = JSON.parse(readFileSync(MCP_PKG_PATH, "utf8")).name;
const serverTitle = "A1 Yandex KIT MCP";

// KitClient stand-in: registration must never touch the client, so every use throws.
const dummyClient = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`KitClient.${String(prop)} must not be used during tool registration`);
    },
  },
);

const toolFiles = readdirSync(TOOLS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();

async function introspectTools(): Promise<ToolSection[]> {
  const sections: ToolSection[] = [];
  for (const file of toolFiles) {
    const tools: RecordedTool[] = [];
    const fakeServer = {
      registerTool(name: string, def: Record<string, unknown>) {
        const annotations = (def.annotations ?? {}) as Record<string, unknown>;
        tools.push({
          name,
          description: String(def.description ?? ""),
          readOnly: annotations.readOnlyHint === true,
        });
      },
    };
    const mod = await import(pathToFileURL(TOOLS_DIR + file).href);
    const registerFns = Object.entries(mod)
      .filter(([key, value]) => key.startsWith("register") && typeof value === "function")
      .map(([, value]) => value as (server: unknown, client: unknown) => void);
    if (registerFns.length === 0) throw new Error(`No register* export found in ${file}`);
    for (const register of registerFns) register(fakeServer, dummyClient);
    if (tools.length === 0) throw new Error(`No tools registered by ${file}`);
    const base = file.replace(/\.ts$/, "");
    sections.push({ file, title: SECTION_TITLES[base] ?? base[0]!.toUpperCase() + base.slice(1), tools });
  }
  return sections;
}

/**
 * Operation ids with a dedicated tool: literals at client call sites plus
 * action-map/ternary values, filtered against the registry. meta.ts is excluded —
 * its tools take the operation id as input and cover everything by design.
 */
function collectCuratedOps(): string[] {
  const CALL_SITE = /\b(?:call|listAll|validateRequestBody)\(\s*"([A-Za-z0-9]+)"/g;
  const MAP_VALUE = /[?:=]\s*"([A-Z][A-Za-z0-9]*)"/g;
  const found = new Set<string>();
  for (const file of toolFiles) {
    if (file === "meta.ts") continue;
    const source = readFileSync(TOOLS_DIR + file, "utf8");
    for (const re of [CALL_SITE, MAP_VALUE]) {
      for (const match of source.matchAll(re)) {
        const id = match[1]!;
        if (registry.ops[id]) found.add(id);
      }
    }
  }
  if (found.size === 0) throw new Error("No curated operations found — extraction regressed?");
  return [...found].sort();
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** First sentence of a description; skips periods of common abbreviations. */
function firstSentence(text: string): string {
  const boundary = /\.(?:\s|$)/g;
  for (const match of text.matchAll(boundary)) {
    const before = text.slice(0, match.index);
    if (/\b(?:e\.g|i\.e|etc|vs)$/i.test(before)) continue;
    return before + ".";
  }
  return text;
}

const sections = await introspectTools();
const curatedOps = collectCuratedOps();
const toolCount = sections.reduce((sum, s) => sum + s.tools.length, 0);

const remainingByTag = new Map<string, RegistryOp[]>();
for (const id of Object.keys(registry.ops).sort()) {
  if (curatedOps.includes(id)) continue;
  const op = registry.ops[id]!;
  const group = remainingByTag.get(op.tag) ?? [];
  group.push(op);
  remainingByTag.set(op.tag, group);
}
const remainingCount = [...remainingByTag.values()].reduce((sum, ops) => sum + ops.length, 0);

const lines: string[] = [];
lines.push("<!-- GENERATED by yandex-kit-codegen — do not edit, run: npm run gen -->");
lines.push("");
lines.push(`# ${serverTitle} — Tool Reference`);
lines.push("");
lines.push(
  `The \`${serverName}\` MCP server exposes **${toolCount} tools** for the Yandex KIT ` +
    "e-commerce API. Curated tools cover the everyday catalog, order and promotions " +
    "workflows; the meta trio — `search_operations`, `get_operation_schema` and " +
    `\`kit_request\` — reaches all ${registry.opsCount} API operations, including those ` +
    "without a dedicated tool.",
);
for (const section of sections) {
  lines.push("");
  lines.push(`## ${section.title} (\`${section.file}\`)`);
  lines.push("");
  lines.push("| Tool | Read-only | Description |");
  lines.push("| --- | --- | --- |");
  for (const tool of section.tools) {
    lines.push(
      `| \`${tool.name}\` | ${tool.readOnly ? "yes" : "no"} | ` +
        `${escapeCell(firstSentence(tool.description))} |`,
    );
  }
}
lines.push("");
lines.push("## Operation coverage");
lines.push("");
lines.push(
  `**${curatedOps.length} of ${registry.opsCount} operations** have dedicated tools. ` +
    `The remaining ${remainingCount} operations below are reachable via \`kit_request\` ` +
    "(discover them with `search_operations`, inspect with `get_operation_schema`).",
);
for (const tag of [...remainingByTag.keys()].sort()) {
  lines.push("");
  lines.push(`### ${tag}`);
  lines.push("");
  lines.push("| Operation | Method | Path | Summary (RU) |");
  lines.push("| --- | --- | --- | --- |");
  for (const op of remainingByTag.get(tag)!) {
    lines.push(
      `| \`${op.id}\` | ${op.method.toUpperCase()} | \`${op.path}\` | ` +
        `${escapeCell(op.summaryRu)} |`,
    );
  }
}
lines.push("");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_DIR + "TOOLS.md", lines.join("\n"));

console.log(
  `gen-docs: ${toolCount} tools in ${sections.length} files, ` +
    `${curatedOps.length}/${registry.opsCount} operations curated`,
);
