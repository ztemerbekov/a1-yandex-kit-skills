import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** One storage implementation, shipped independently in npm and the setup skill. */
export function syncConnectionsModule(
  source = fileURLToPath(new URL("../../core/src/connections.mjs", import.meta.url)),
  destination = fileURLToPath(new URL("../../../skills/a1-yandex-kit-setup/scripts/lib/connections.mjs", import.meta.url)),
): void {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}
