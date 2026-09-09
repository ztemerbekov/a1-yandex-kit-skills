import { spawn } from "node:child_process";

import { SetupError } from "./shared.mjs";

const TOKEN_PAGE_SECRET = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_OPEN_WAIT_MS = 2_000;

function invalidTokenPageUrl() {
  return new SetupError(
    "The URL must be an http://127.0.0.1:<port> one-time token page.",
    "INVALID_TOKEN_WEB_URL",
  );
}

// The URL contains the one-time page secret, so only accept the exact shape
// emitted by token-web. In particular, never let this command open a URL with
// credentials, a fragment, another host, or an extra query parameter.
export function validateTokenPageUrl(value) {
  if (typeof value !== "string" || value.length > 512) {
    throw invalidTokenPageUrl();
  }
  let pageUrl;
  try {
    pageUrl = new URL(value);
  } catch {
    throw invalidTokenPageUrl();
  }
  if (
    pageUrl.protocol !== "http:" ||
    pageUrl.hostname !== "127.0.0.1" ||
    !pageUrl.port ||
    pageUrl.pathname !== "/" ||
    pageUrl.username ||
    pageUrl.password ||
    pageUrl.hash ||
    pageUrl.searchParams.size !== 1 ||
    !pageUrl.searchParams.has("secret") ||
    !TOKEN_PAGE_SECRET.test(pageUrl.searchParams.get("secret") || "")
  ) {
    throw invalidTokenPageUrl();
  }
  return pageUrl;
}

function browserInvocation(platform, env, url) {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
    };
  }
  if (platform === "linux" || platform === "freebsd" || platform === "openbsd") {
    return { command: "xdg-open", args: [url] };
  }
  return null;
}

// Open the page through the operating system's default browser. The caller
// owns the live token-web process; an opener failure is a result, never a
// reason to stop that process. `spawnImpl` is injectable for no-network tests.
export function openTokenPage({
  url,
  platform = process.platform,
  env = process.env,
  spawnImpl = spawn,
  waitMs = MAX_OPEN_WAIT_MS,
} = {}) {
  const pageUrl = validateTokenPageUrl(url);
  // Rebuild from validated components so an encoded or unusual input cannot
  // add command syntax when this URL is handed to a platform opener.
  const target = `http://127.0.0.1:${pageUrl.port}/?secret=${pageUrl.searchParams.get("secret")}`;
  const invocation = browserInvocation(platform, env, target);
  if (!invocation) {
    return Promise.resolve({
      url: target,
      opened: false,
      code: "BROWSER_UNAVAILABLE",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (opened, code = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ url: target, opened, ...(code ? { code } : {}) });
    };

    let child;
    try {
      child = spawnImpl(invocation.command, invocation.args, {
        env,
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      finish(false, "BROWSER_OPEN_FAILED");
      return;
    }

    const onError = (error) =>
      finish(
        false,
        error?.code === "ENOENT"
          ? "BROWSER_UNAVAILABLE"
          : "BROWSER_OPEN_FAILED",
      );
    const onClose = (code) =>
      finish(code === 0, code === 0 ? null : "BROWSER_OPEN_FAILED");
    child.once("error", onError);
    child.once("close", onClose);

    const timeout = Number(waitMs);
    if (Number.isFinite(timeout) && timeout > 0) {
      timer = setTimeout(
        () => finish(false, "BROWSER_OPEN_FAILED"),
        timeout,
      );
    }
    child.unref?.();
  });
}
