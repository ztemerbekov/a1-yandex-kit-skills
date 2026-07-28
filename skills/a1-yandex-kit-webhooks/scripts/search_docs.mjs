#!/usr/bin/env node
/**
 * Offline search over the bundled Yandex KIT OpenAPI spec (data/kit_v1.json.gz).
 *
 * Dependency-free: plain Node.js >= 20, builtins only — no npm install needed.
 *
 *   node search_docs.mjs "<query>" [--tag "<Тег>"] [--limit N]   search operations
 *   node search_docs.mjs --tag "<Тег>"                           list every operation of a tag
 *   node search_docs.mjs --operation <OperationId>               full params + schemas
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const DATA_PATH = fileURLToPath(new URL("../data/kit_v1.json.gz", import.meta.url));
const REF_DEPTH_CAP = 30;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

const USAGE = `Usage:
  node search_docs.mjs "<query>" [--tag "<Тег>"] [--limit N]   search operations (default limit 10)
  node search_docs.mjs --tag "<Тег>"                           list every operation of a tag
  node search_docs.mjs --operation <OperationId>               print full parameters + request/response schemas

Examples:
  node search_docs.mjs "создать товар"
  node search_docs.mjs "webhook" --limit 5
  node search_docs.mjs --tag "Заказы"
  node search_docs.mjs --operation CreateProduct`;

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Load the gzipped OpenAPI spec and index its operations in spec order.
// ---------------------------------------------------------------------------

const spec = JSON.parse(gunzipSync(readFileSync(DATA_PATH)).toString("utf8"));

const ops = [];
for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const method of HTTP_METHODS) {
    const op = pathItem[method];
    if (!op) continue;
    ops.push({
      id: op.operationId,
      method: method.toUpperCase(),
      path,
      tag: op.tags?.[0] ?? "",
      summary: op.summary ?? "",
      description: op.description ?? "",
      raw: op,
      pathLevelParams: pathItem.parameters ?? [],
    });
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
let query = null;
let tagFilter = null;
let limit = 10;
let operationId = null;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--operation") {
    operationId = argv[++i];
    if (!operationId) fail("--operation requires an OperationId\n\n" + USAGE);
  } else if (arg === "--tag") {
    tagFilter = argv[++i];
    if (!tagFilter) fail("--tag requires a tag name\n\n" + USAGE);
  } else if (arg === "--limit") {
    limit = Number(argv[++i]);
    if (!Number.isInteger(limit) || limit < 1) fail("--limit requires a positive integer\n\n" + USAGE);
  } else if (arg.startsWith("--")) {
    fail(`Unknown option: ${arg}\n\n` + USAGE);
  } else if (query === null) {
    query = arg;
  } else {
    fail(`Unexpected argument: ${arg}\n\n` + USAGE);
  }
}

// ---------------------------------------------------------------------------
// $ref dereferencing (cycle-safe): inline every local ref, mark repeats.
// ---------------------------------------------------------------------------

function resolveRefTarget(ref) {
  if (!ref.startsWith("#/")) throw new Error(`Unsupported external $ref: ${ref}`);
  let node = spec;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    node = node?.[segment];
    if (node === undefined) throw new Error(`Unresolvable $ref: ${ref}`);
  }
  return node;
}

function deref(node, refStack) {
  if (Array.isArray(node)) return node.map((item) => deref(item, refStack));
  if (node === null || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    if (refStack.includes(ref) || refStack.length >= REF_DEPTH_CAP) {
      return { $circular: ref };
    }
    return deref(resolveRefTarget(ref), [...refStack, ref]);
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = deref(value, refStack);
  }
  return out;
}

// ---------------------------------------------------------------------------
// --operation mode: full contract of a single operation
// ---------------------------------------------------------------------------

/** Dice similarity over character bigrams (for "did you mean" hints). */
function bigramSimilarity(a, b) {
  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const bigram of setA) if (setB.has(bigram)) shared++;
  return (2 * shared) / (setA.size + setB.size);
}

function printOperation(id) {
  const op = ops.find((o) => o.id === id);
  if (!op) {
    const target = id.toLowerCase();
    const similar = ops
      .map((o) => ({ id: o.id, score: bigramSimilarity(target, o.id.toLowerCase()) }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, 5)
      .map((entry) => entry.id);
    fail(`Operation "${id}" not found, similar: ${similar.join(", ")}`);
  }

  // Path-level parameters first, operation-level override by (name, in).
  const merged = [...op.pathLevelParams];
  for (const param of op.raw.parameters ?? []) {
    const index = merged.findIndex((m) => m.name === param.name && m.in === param.in);
    if (index >= 0) merged[index] = param;
    else merged.push(param);
  }

  const contentTypes = Object.keys(op.raw.requestBody?.content ?? {});
  const contentType = contentTypes[0] ?? null;
  const requestSchema = contentType ? (op.raw.requestBody.content[contentType].schema ?? null) : null;

  const responseStatus = ["200", "201"].find((status) => op.raw.responses?.[status]) ?? null;
  const responseSchema =
    responseStatus !== null
      ? (op.raw.responses[responseStatus].content?.["application/json"]?.schema ?? null)
      : null;

  const detail = {
    operationId: op.id,
    method: op.method,
    path: op.path,
    tag: op.tag,
    summary: op.summary,
    description: op.description || undefined,
    pathParams: merged.filter((p) => p.in === "path").map((p) => deref(p, [])),
    queryParams: merged.filter((p) => p.in === "query").map((p) => deref(p, [])),
    request: contentType
      ? {
          contentType,
          required: op.raw.requestBody.required === true,
          schema: requestSchema !== null ? deref(requestSchema, []) : null,
        }
      : null,
    response:
      responseStatus !== null
        ? { status: Number(responseStatus), schema: responseSchema !== null ? deref(responseSchema, []) : null }
        : null,
  };
  console.log(JSON.stringify(detail, null, 2));
}

// ---------------------------------------------------------------------------
// Query mode: case-insensitive token scoring.
// Weights: operationId/path 3, tag 2, summary 2, description 1.
// Tokens match as substrings, falling back to progressively shorter prefixes
// (down to 4 chars) so inflected Russian forms still hit: "отменить" reaches
// "Отмена заказа" via "отмен", "подтвердить" reaches "Подтверждение" via
// "подтвер". Shorter (weaker) prefix hits score proportionally lower.
// Operations matching more query tokens rank first; tokens that match nothing
// anywhere are ignored with a note instead of zeroing the whole query.
// ---------------------------------------------------------------------------

const FIELD_WEIGHTS = [
  ["id", 3],
  ["path", 3],
  ["tag", 2],
  ["summary", 2],
  ["description", 1],
];

/** The token itself plus its prefixes down to 4 chars, longest first. */
function tokenVariants(token) {
  const variants = [token];
  for (let length = token.length - 1; length >= 4; length--) {
    variants.push(token.slice(0, length));
  }
  return variants;
}

/** Weighted per-field score of one token; 0 when no field matches any variant. */
function tokenScore(op, token) {
  const variants = tokenVariants(token);
  let score = 0;
  for (const [field, weight] of FIELD_WEIGHTS) {
    const text = op[field].toLowerCase();
    const hit = variants.find((variant) => text.includes(variant));
    if (hit !== undefined) score += weight * (hit.length / token.length);
  }
  return score;
}

function scoreOperation(op, tokens) {
  let matched = 0;
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(op, token);
    if (score > 0) {
      matched++;
      total += score;
    }
  }
  return { matched, score: total };
}

function printResults(results) {
  const idWidth = Math.max(...results.map((r) => r.id.length));
  const methodWidth = Math.max(...results.map((r) => r.method.length));
  for (const r of results) {
    console.log(`${r.id.padEnd(idWidth)}  ${r.method.padEnd(methodWidth)} ${r.path} — ${r.summary} [${r.tag}]`);
  }
  console.log("\nDetails: node search_docs.mjs --operation <OperationId>");
}

function runSearch() {
  let pool = ops;
  if (tagFilter !== null) {
    pool = ops.filter((op) => op.tag === tagFilter);
    if (pool.length === 0) {
      const tags = [...new Set(ops.map((op) => op.tag))];
      fail(`Unknown tag "${tagFilter}". Valid tags: ${tags.join(", ")}`);
    }
  }

  if (query === null || query.trim() === "") {
    // --tag without a query: list the whole tag in spec order.
    printResults(pool);
    return;
  }

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = pool
    .map((op, index) => ({ op, index, ...scoreOperation(op, tokens) }))
    .filter((entry) => entry.matched > 0)
    .sort((a, b) => b.matched - a.matched || b.score - a.score || a.index - b.index);

  if (scored.length === 0) {
    process.stderr.write(
      `No operations matched "${query}"${tagFilter !== null ? ` in tag "${tagFilter}"` : ""}. ` +
        "Try fewer or different words (Russian summaries: e.g. \"товар\", \"заказ\", \"скидка\").\n",
    );
    process.exit(1);
  }

  const ignored = tokens.filter((token) => !pool.some((op) => tokenScore(op, token) > 0));
  if (ignored.length > 0) {
    process.stderr.write(
      `note: no matches for ${ignored.map((token) => `"${token}"`).join(", ")} — ranking by the remaining terms.\n`,
    );
  }

  printResults(scored.slice(0, limit).map((entry) => entry.op));
}

if (operationId !== null) {
  printOperation(operationId);
} else if (query !== null || tagFilter !== null) {
  runSearch();
} else {
  fail(USAGE);
}
