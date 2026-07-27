#!/usr/bin/env node
/**
 * Offline request-body validation against the bundled Yandex KIT OpenAPI spec
 * (data/kit_v1.json.gz). Bundled with esbuild so that Ajv is vendored — plain
 * Node.js >= 20 is enough, no npm install needed.
 *
 *   node validate.mjs --operation <OperationId> --body '<json>'
 *   node validate.mjs --operation <OperationId> --body-file body.json
 *
 * Exit codes: 0 — body is valid (prints VALID) or the operation expects no
 * body; 1 — body violates the schema (prints the errors); 2 — usage error.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import AjvImport from "ajv";

const AjvClass = typeof AjvImport === "function" ? AjvImport : AjvImport.default;

const DATA_PATH = fileURLToPath(new URL("../data/kit_v1.json.gz", import.meta.url));
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

const USAGE = `Usage:
  node validate.mjs --operation <OperationId> --body '<json>'
  node validate.mjs --operation <OperationId> --body-file <path>

Examples:
  node validate.mjs --operation CreateWebhook --body '{"url":"https://example.com/hook","events":["ORDER_STATUS_CHANGED"]}'
  node validate.mjs --operation CreateProduct --body-file product.json`;

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
let operationId = null;
let bodyText = null;
let bodyFile = null;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--operation") {
    operationId = argv[++i];
    if (!operationId) fail("--operation requires an OperationId\n\n" + USAGE);
  } else if (arg === "--body") {
    bodyText = argv[++i];
    if (bodyText === undefined) fail("--body requires a JSON string\n\n" + USAGE);
  } else if (arg === "--body-file") {
    bodyFile = argv[++i];
    if (!bodyFile) fail("--body-file requires a path\n\n" + USAGE);
  } else {
    fail(`Unexpected argument: ${arg}\n\n` + USAGE);
  }
}

if (operationId === null) fail("--operation is required\n\n" + USAGE);
if (bodyText !== null && bodyFile !== null) fail("Pass either --body or --body-file, not both\n\n" + USAGE);

if (bodyFile !== null) {
  try {
    bodyText = readFileSync(bodyFile, "utf8");
  } catch (error) {
    fail(`Cannot read --body-file ${bodyFile}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Locate the operation in the bundled spec
// ---------------------------------------------------------------------------

const spec = JSON.parse(gunzipSync(readFileSync(DATA_PATH)).toString("utf8"));

let operation = null;
for (const pathItem of Object.values(spec.paths)) {
  for (const method of HTTP_METHODS) {
    const op = pathItem[method];
    if (op && op.operationId === operationId) operation = op;
  }
}
/** Dice similarity over character bigrams (same "did you mean" as search_docs.mjs). */
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

if (operation === null) {
  const known = [];
  for (const pathItem of Object.values(spec.paths)) {
    for (const method of HTTP_METHODS) {
      if (pathItem[method]) known.push(pathItem[method].operationId);
    }
  }
  const target = operationId.toLowerCase();
  const similar = known
    .map((id) => ({ id, score: bigramSimilarity(target, id.toLowerCase()) }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, 5)
    .map((entry) => entry.id);
  fail(`Operation "${operationId}" not found, similar: ${similar.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Schema preparation: OpenAPI 3.0 `nullable: true` is not JSON Schema —
// rewrite it into a type union with "null" (and extend enums), exactly like
// the yandex-kit-core runtime validator does.
// ---------------------------------------------------------------------------

function transformNullable(node) {
  if (Array.isArray(node)) return node.map(transformNullable);
  if (node === null || typeof node !== "object") return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    // Only drop the OpenAPI keyword; a property literally named "nullable"
    // inside a `properties` map holds an object, not a boolean.
    if (key === "nullable" && typeof value === "boolean") continue;
    out[key] = transformNullable(value);
  }
  if (node.nullable === true) {
    if (typeof out.type === "string") out.type = [out.type, "null"];
    else if (Array.isArray(out.type)) {
      if (!out.type.includes("null")) out.type = [...out.type, "null"];
    } else {
      // No sibling `type` (allOf/$ref form): wrap the whole schema instead.
      return { anyOf: [{ type: "null" }, out] };
    }
    if (Array.isArray(out.enum) && !out.enum.includes(null)) {
      out.enum = [...out.enum, null];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

const contentTypes = Object.keys(operation.requestBody?.content ?? {});
const contentType = contentTypes[0] ?? null;
const rawSchema = contentType ? (operation.requestBody.content[contentType].schema ?? null) : null;

const bodyProvided = bodyText !== null && bodyText.trim() !== "";

if (rawSchema === null) {
  if (bodyProvided) {
    process.stderr.write(`${operationId} expects no request body, but a body was provided.\n`);
    process.exit(1);
  }
  console.log(`no request body expected for ${operationId}`);
  process.exit(0);
}

if (!bodyProvided) {
  fail(`${operationId} expects a ${contentType} request body: pass --body '<json>' or --body-file <path>`);
}

let body;
try {
  body = JSON.parse(bodyText);
} catch (error) {
  fail(`--body is not valid JSON: ${error.message}`);
}

const rootSchema =
  typeof rawSchema.$ref === "string" ? { $ref: rawSchema.$ref } : transformNullable(rawSchema);
const ajv = new AjvClass({ strict: false, allErrors: true, validateFormats: false });
const validate = ajv.compile({
  ...rootSchema,
  components: { schemas: transformNullable(spec.components?.schemas ?? {}) },
});

if (validate(body)) {
  console.log("VALID");
  if (contentType === "application/merge-patch+json") {
    console.log(
      "note: this operation uses JSON Merge Patch — send only the fields to change; null clears a field only where the schema marks it nullable",
    );
  }
  process.exit(0);
}

const errors = (validate.errors ?? []).map(
  (e) => `${e.instancePath || "(root)"}: ${e.message ?? "invalid"}`,
);
process.stderr.write(`INVALID: ${errors.length} error(s) for ${operationId}\n`);
for (const line of errors) process.stderr.write(`  - ${line}\n`);
process.exit(1);
