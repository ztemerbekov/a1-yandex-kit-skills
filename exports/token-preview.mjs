import { startTokenWeb } from "../skills/a1-yandex-kit-setup/scripts/lib/token-web.mjs";

const PREVIEW_ERROR = new Error("preview cannot save");

function previewMode(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--mode") return argv[index + 1] || "connect";
    if (argument.startsWith("--mode=")) return argument.slice("--mode=".length);
  }
  return "connect";
}

const mode = previewMode(process.argv.slice(2));

const web = await startTokenWeb({
  timeoutSeconds: 3600,
  mode,
  validateToken: async () => {
    throw PREVIEW_ERROR;
  },
  persistToken: async () => {
    throw PREVIEW_ERROR;
  },
});

console.log(`Token page preview (${mode} mode): ${web.url}`);
console.log("Read-only preview; it expires in 3600 seconds.");
console.log("Stop with Ctrl-C. No credentials or config files are read or written.");

const stop = () => web.stop();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await web.done;
} catch (error) {
  if (error?.code !== "TOKEN_WEB_CLOSED") {
    console.error(error);
    process.exitCode = 1;
  }
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
