/**
 * Generates packages/core/src/generated/registry.json (compact operation registry)
 * from specs/kit-swagger.openapi.json and copies the spec verbatim to spec.json.
 *
 * Run: npm run gen (repo root) or tsx src/gen-registry.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SPEC_PATH = fileURLToPath(new URL("../../../specs/kit-swagger.openapi.json", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("../../core/src/generated/", import.meta.url));

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

interface RegistryQueryParam {
  name: string;
  required: boolean;
  type: string;
  enum: string[] | null;
  minimum: number | null;
  maximum: number | null;
  default: unknown;
  descriptionRu: string | null;
}

interface RegistryOp {
  id: string;
  method: string;
  path: string;
  tag: string;
  summaryRu: string;
  descriptionRu: string | null;
  pathParams: string[];
  queryParams: RegistryQueryParam[];
  requestContentType: string | null;
  requestSchemaRef: string | null;
  responseSchemaRef: string | null;
  paginated: boolean;
  itemsProp: string | null;
}

const specRaw = readFileSync(SPEC_PATH, "utf8");
const spec = JSON.parse(specRaw);

/** Resolves a local "#/components/schemas/X" ref; returns the node itself if not a ref. */
function resolveSchema(node: any): any {
  let current = node;
  // Follow ref chains defensively (spec has no chains today).
  for (let i = 0; i < 10 && current && typeof current.$ref === "string"; i++) {
    const ref: string = current.$ref;
    if (!ref.startsWith("#/")) throw new Error(`Non-local $ref not supported: ${ref}`);
    current = ref
      .slice(2)
      .split("/")
      .reduce((acc: any, part: string) => acc?.[part], spec);
    if (current === undefined) throw new Error(`Unresolvable $ref: ${ref}`);
  }
  return current;
}

function toQueryParam(param: any): RegistryQueryParam {
  const schema = resolveSchema(param.schema ?? {});
  let enumValues: string[] | null = schema.enum ?? null;
  if (!enumValues && schema.type === "array" && schema.items) {
    // Surface allowed values for array-of-enum filters (e.g. status).
    enumValues = resolveSchema(schema.items).enum ?? null;
  }
  return {
    name: param.name,
    required: param.required === true,
    type: schema.type ?? "string",
    enum: enumValues,
    minimum: schema.minimum ?? null,
    maximum: schema.maximum ?? null,
    default: schema.default ?? null,
    descriptionRu: param.description ?? schema.description ?? null,
  };
}

const ops: Record<string, RegistryOp> = {};
let paginatedCount = 0;
const mergePatchOps: string[] = [];

for (const [path, pathItem] of Object.entries<any>(spec.paths)) {
  const pathLevelParams: any[] = pathItem.parameters ?? [];
  for (const method of HTTP_METHODS) {
    const op = pathItem[method];
    if (!op) continue;
    if (!op.operationId) throw new Error(`Missing operationId: ${method.toUpperCase()} ${path}`);
    if (ops[op.operationId]) throw new Error(`Duplicate operationId: ${op.operationId}`);

    // Path-level parameters first, operation-level override by (name, in).
    const merged = [...pathLevelParams];
    for (const p of op.parameters ?? []) {
      const i = merged.findIndex((m) => m.name === p.name && m.in === p.in);
      if (i >= 0) merged[i] = p;
      else merged.push(p);
    }

    const pathParams = merged.filter((p) => p.in === "path").map((p) => p.name as string);
    const queryParams = merged.filter((p) => p.in === "query").map(toQueryParam);

    const contentTypes = Object.keys(op.requestBody?.content ?? {});
    if (contentTypes.length > 1) {
      throw new Error(`Multiple request content types for ${op.operationId}: ${contentTypes.join(", ")}`);
    }
    const requestContentType = contentTypes[0] ?? null;
    const requestSchemaRef = requestContentType
      ? (op.requestBody.content[requestContentType].schema?.$ref ?? null)
      : null;

    const successResponse = op.responses?.["200"] ?? op.responses?.["201"];
    const responseSchemaRef = successResponse?.content?.["application/json"]?.schema?.$ref ?? null;

    const paginated =
      queryParams.some((q) => q.name === "page") && queryParams.some((q) => q.name === "per_page");

    // itemsProp: the single array property of the response component, if unambiguous.
    let itemsProp: string | null = null;
    if (responseSchemaRef) {
      const component = resolveSchema({ $ref: responseSchemaRef });
      const arrayProps = Object.entries<any>(component?.properties ?? {}).filter(
        ([, propSchema]) => propSchema.type === "array",
      );
      if (arrayProps.length === 1) itemsProp = arrayProps[0]![0];
    }

    if (paginated) paginatedCount++;
    if (requestContentType === "application/merge-patch+json") mergePatchOps.push(op.operationId);

    ops[op.operationId] = {
      id: op.operationId,
      method,
      path,
      tag: op.tags?.[0] ?? "",
      summaryRu: op.summary ?? "",
      descriptionRu: op.description ?? null,
      pathParams,
      queryParams,
      requestContentType,
      requestSchemaRef,
      responseSchemaRef,
      paginated,
      itemsProp,
    };
  }
}

const registry = {
  specTitle: spec.info.title,
  specVersion: spec.info.version,
  opsCount: Object.keys(ops).length,
  ops,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_DIR + "registry.json", JSON.stringify(registry, null, 2) + "\n");
writeFileSync(OUT_DIR + "spec.json", specRaw);

console.log(
  `gen-registry: ${registry.opsCount} operations, ${paginatedCount} paginated, ` +
    `merge-patch: ${mergePatchOps.join(", ")}`,
);
