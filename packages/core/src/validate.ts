/**
 * Request-body validation (Ajv) and schema resolution helpers driven by the
 * generated operation registry and the bundled OpenAPI spec.
 */
import AjvImport, { Ajv as AjvNamed } from "ajv";
import type { Ajv, ValidateFunction } from "ajv";

import { getOp, loadSpec } from "./registry.js";

// ajv v8 is CJS; depending on the loader the class may sit on the named
// export, the default export, or `.default` of the default export.
const AjvClass: typeof AjvNamed =
  AjvNamed ??
  (AjvImport as unknown as { default?: typeof AjvNamed }).default ??
  (AjvImport as unknown as typeof AjvNamed);

const REF_DEPTH_CAP = 30;

let ajvInstance: Ajv | undefined;
let transformedSchemas: Record<string, unknown> | undefined;
const validatorCache = new Map<string, ValidateFunction>();

/**
 * OpenAPI 3.0 `nullable: true` is not JSON Schema; rewrite it into a type
 * union with "null" (and extend enums) so Ajv validates it correctly.
 */
function transformNullable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(transformNullable);
  if (node === null || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    // Only drop the OpenAPI keyword; a property literally named "nullable"
    // inside a `properties` map holds an object, not a boolean.
    if (key === "nullable" && typeof value === "boolean") continue;
    out[key] = transformNullable(value);
  }
  if (src.nullable === true) {
    if (typeof out.type === "string") out.type = [out.type, "null"];
    else if (Array.isArray(out.type)) {
      if (!out.type.includes("null")) out.type = [...out.type, "null"];
    } else {
      // No sibling `type` (allOf/$ref form, e.g. {allOf:[{$ref:X}],nullable:true}):
      // widening `type` is impossible, so wrap the whole schema instead.
      return { anyOf: [{ type: "null" }, out] };
    }
    if (Array.isArray(out.enum) && !out.enum.includes(null)) {
      out.enum = [...out.enum, null];
    }
  }
  return out;
}

function getTransformedSchemas(): Record<string, unknown> {
  transformedSchemas ??= transformNullable(
    loadSpec().components?.schemas ?? {},
  ) as Record<string, unknown>;
  return transformedSchemas;
}

function getAjv(): Ajv {
  ajvInstance ??= new AjvClass({
    strict: false,
    allErrors: true,
    validateFormats: false,
  });
  return ajvInstance;
}

function getValidator(operationId: string, schemaRef: string): ValidateFunction {
  const cached = validatorCache.get(operationId);
  if (cached) return cached;
  // Wrap the ref together with all (nullable-transformed) component schemas
  // so internal "#/components/schemas/X" pointers resolve locally.
  const validate = getAjv().compile({
    $ref: schemaRef,
    components: { schemas: getTransformedSchemas() },
  });
  validatorCache.set(operationId, validate);
  return validate;
}

export function validateRequestBody(
  operationId: string,
  body: unknown,
): { valid: boolean; errors: string[] } {
  const op = getOp(operationId);
  if (!op.requestSchemaRef) return { valid: true, errors: [] };

  const validate = getValidator(operationId, op.requestSchemaRef);
  if (validate(body)) return { valid: true, errors: [] };

  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"}: ${e.message ?? "invalid"}`,
  );
  return { valid: false, errors };
}

function resolveRefTarget(ref: string): unknown {
  if (!ref.startsWith("#/")) {
    throw new Error(`Unsupported external $ref: ${ref}`);
  }
  let node: any = loadSpec();
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    node = node?.[segment];
    if (node === undefined) throw new Error(`Unresolvable $ref: ${ref}`);
  }
  return node;
}

/**
 * Inline every $ref. A ref already being expanded on the current branch (or
 * expansion beyond the depth cap) is replaced with {"$circular": "<ref>"}.
 */
function deref(node: unknown, refStack: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map((item) => deref(item, refStack));
  if (node === null || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  if (typeof src.$ref === "string") {
    const ref = src.$ref;
    if (refStack.includes(ref) || refStack.length >= REF_DEPTH_CAP) {
      return { $circular: ref };
    }
    return deref(resolveRefTarget(ref), [...refStack, ref]);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    out[key] = deref(value, refStack);
  }
  return out;
}

export function resolveOperationSchema(operationId: string): {
  request?: unknown;
  response?: unknown;
} {
  const op = getOp(operationId);
  const result: { request?: unknown; response?: unknown } = {};
  if (op.requestSchemaRef) {
    result.request = deref({ $ref: op.requestSchemaRef }, []);
  }
  if (op.responseSchemaRef) {
    result.response = deref({ $ref: op.responseSchemaRef }, []);
  }
  return result;
}
