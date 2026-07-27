/**
 * Refreshes the local OpenAPI spec snapshot from the official Yandex URL.
 * Prints "spec unchanged" if the bytes are identical, otherwise overwrites
 * specs/kit-swagger.openapi.json and reports old/new path+operation counts.
 *
 * Run: npm run spec:fetch (repo root) or tsx src/fetch-spec.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SPEC_URL = "https://yandex.ru/dev/kit/ru/openapi/kit-swagger.openapi.json";
const SPEC_PATH = fileURLToPath(new URL("../../../specs/kit-swagger.openapi.json", import.meta.url));

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function countOps(spec: any): { paths: number; operations: number } {
  const paths = Object.keys(spec.paths ?? {});
  let operations = 0;
  for (const path of paths) {
    for (const method of HTTP_METHODS) {
      if (spec.paths[path][method]) operations++;
    }
  }
  return { paths: paths.length, operations };
}

const res = await fetch(SPEC_URL);
if (!res.ok) {
  console.error(`fetch-spec: HTTP ${res.status} from ${SPEC_URL}`);
  process.exit(1);
}
const remoteRaw = await res.text();
const localRaw = readFileSync(SPEC_PATH, "utf8");

if (remoteRaw === localRaw) {
  console.log("spec unchanged");
} else {
  const oldCounts = countOps(JSON.parse(localRaw));
  const newCounts = countOps(JSON.parse(remoteRaw));
  writeFileSync(SPEC_PATH, remoteRaw);
  console.log(`spec updated: ${SPEC_PATH}`);
  console.log(`old: ${oldCounts.paths} paths / ${oldCounts.operations} operations`);
  console.log(`new: ${newCounts.paths} paths / ${newCounts.operations} operations`);
  console.log("Re-run: npm run gen");
}
