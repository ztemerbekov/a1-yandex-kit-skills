/**
 * Access to the generated operation registry (generated/registry.json) and
 * the bundled OpenAPI spec (generated/spec.json). Both are loaded lazily via
 * readFileSync (no JSON import attributes — node 20 compat) and cached.
 */
import { readFileSync } from "node:fs";

export interface RegistryQueryParam {
  name: string;
  required: boolean;
  type: string;
  enum?: string[] | null;
  minimum?: number | null;
  maximum?: number | null;
  default?: unknown;
  descriptionRu?: string | null;
}

export interface RegistryOp {
  id: string;
  method: string;
  path: string;
  tag: string;
  summaryRu: string;
  descriptionRu?: string | null;
  pathParams: string[];
  queryParams: RegistryQueryParam[];
  requestContentType?: string | null;
  requestSchemaRef?: string | null;
  responseSchemaRef?: string | null;
  paginated: boolean;
  itemsProp?: string | null;
}

export interface Registry {
  specTitle: string;
  specVersion: string;
  opsCount: number;
  ops: Record<string, RegistryOp>;
}

let cachedRegistry: Registry | undefined;
let cachedSpec: any;

export function getRegistry(): Registry {
  cachedRegistry ??= JSON.parse(
    readFileSync(new URL("./generated/registry.json", import.meta.url), "utf8"),
  ) as Registry;
  return cachedRegistry;
}

export function getOp(operationId: string): RegistryOp {
  const op = getRegistry().ops[operationId];
  if (!op) throw new Error(`Unknown operationId: ${operationId}`);
  return op;
}

export function loadSpec(): any {
  cachedSpec ??= JSON.parse(
    readFileSync(new URL("./generated/spec.json", import.meta.url), "utf8"),
  );
  return cachedSpec;
}
