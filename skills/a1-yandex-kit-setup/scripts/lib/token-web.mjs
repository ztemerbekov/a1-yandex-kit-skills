import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SetupError } from "./shared.mjs";

export const DEFAULT_TOKEN_WEB_TIMEOUT_SECONDS = 300;
export const MAX_TOKEN_WEB_TIMEOUT_SECONDS = 3600;
const MAX_BODY_BYTES = 8192;
const MAX_REJECTED_REQUESTS = 20;
const RESPONSE_CLEANUP_TIMEOUT_MS = 1_000;
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), "assets");

function readAssetDataUri(filename, contentType) {
  const content = readFileSync(join(ASSET_DIR, filename)).toString("base64");
  return `data:${contentType};base64,${content}`;
}

const BACKGROUND_DATA_URI = readAssetDataUri(
  "kit-background.webp",
  "image/webp",
);
const LOGO_DATA_URI = readAssetDataUri("kit-logo.svg", "image/svg+xml");
const DISPLAY_FONT_DATA_URI = readAssetDataUri(
  "ys-display-cond-black.woff2",
  "font/woff2",
);

// The token arrives over plain loopback HTTP, so the page defends in depth:
// requests must come from a loopback peer, name a loopback Host (a browser
// lured to attacker.example resolving to 127.0.0.1 sends its own Host — this
// check breaks DNS rebinding), and present the one-time secret. The page
// itself may load nothing from the network and may never be framed.
const LOOPBACK_PEERS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; " +
    "font-src data:; form-action 'self'; " +
    "base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

// Hashing both sides first lets timingSafeEqual accept candidates of any
// length without revealing how much of the secret matched.
function secretMatches(expected, candidate) {
  const expectedDigest = createHash("sha256").update(String(expected)).digest();
  const candidateDigest = createHash("sha256")
    .update(String(candidate))
    .digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}

const PAGE_STYLE = `
  @font-face {
    font-family: "YS Display Cond";
    src: url("${DISPLAY_FONT_DATA_URI}") format("woff2");
    font-display: swap;
    font-style: normal;
    font-weight: 900;
  }

  :root {
    color-scheme: light;
    --ink: #180b30;
    --muted-ink: #6c6577;
    --coral: #fd6124;
    --line: #e6e1e9;
  }

  *, *::before, *::after { box-sizing: border-box; }

  html {
    min-height: 100%;
    background: #f26c4c;
  }

  body {
    min-width: 320px;
    min-height: 100vh;
    margin: 0;
    color: var(--ink);
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
    background-color: #f26c4c;
    background-image: url("${BACKGROUND_DATA_URI}");
    background-position: center top;
    background-repeat: no-repeat;
    background-size: cover;
  }

  .page-shell {
    width: 100%;
    max-width: 700px;
    min-height: 100vh;
    margin: 0 auto;
    padding: 50px 0 48px;
  }

  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 28px;
    color: #fff;
  }

  .brand__logo {
    display: block;
    width: 152px;
    height: 28px;
    overflow: hidden;
    flex: 0 0 152px;
  }

  .brand__logo img {
    display: block;
    width: 282px;
    max-width: none;
    height: 28px;
  }

  .brand__skills {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 0 13px;
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 999px;
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }

  .page-content {
    margin-top: 44px;
  }

  .hero {
    color: #fff;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-family: "YS Display Cond", "Arial Narrow", Arial, sans-serif;
    font-size: clamp(40px, 6.2vw, 54px);
    font-weight: 900;
    letter-spacing: -0.015em;
    line-height: 1.05;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .card {
    width: 100%;
    max-width: 560px;
    margin: 24px auto 0;
    padding: 32px;
    border-radius: 24px;
    background: #fff;
    box-shadow: 0 22px 56px rgba(106, 37, 43, 0.18);
  }

  .card--status { text-align: center; }

  .field-label {
    display: block;
    margin: 0;
    color: var(--ink);
    font-size: 13px;
    font-weight: 800;
    line-height: 18px;
  }

  .card__instructions {
    max-width: 540px;
    margin: 0;
    color: var(--muted-ink);
    font-size: 15px;
    line-height: 22px;
  }

  .card form { margin-top: 8px; }
  .card__privacy { margin: 12px 0 0; color: var(--muted-ink); font-size: 13px; line-height: 19px; }
  .card__consequence { margin: 10px 0 0; color: var(--ink); font-size: 13px; font-weight: 700; line-height: 19px; }
  .card__consequence + button { margin-top: 10px; }

  input {
    display: block;
    width: 100%;
    min-height: 56px;
    margin: 0;
    padding: 15px 17px;
    border: 2px solid var(--line);
    border-radius: 16px;
    outline: none;
    color: var(--ink);
    background: #fff;
    font: inherit;
    font-size: 16px;
    line-height: 22px;
    transition: border-color 160ms ease, box-shadow 160ms ease;
  }

  input:hover { border-color: #bab3c3; }

  input:focus {
    border-color: var(--ink);
    box-shadow: 0 0 0 4px rgba(24, 11, 48, 0.12);
  }

  input[aria-invalid="true"] {
    border-color: #c83c32;
  }

  .error {
    margin: 12px 0 0;
    padding: 13px 15px;
    border: 1px solid #f0b7af;
    border-radius: 16px;
    color: #a92d24;
    background: #fff3f0;
    font-size: 14px;
    font-weight: 700;
    line-height: 20px;
  }

  button {
    display: block;
    width: 100%;
    min-height: 56px;
    margin-top: 12px;
    padding: 15px 22px;
    border: 0;
    border-radius: 16px;
    cursor: pointer;
    color: #fff;
    background: var(--ink);
    font: inherit;
    font-size: 16px;
    font-weight: 800;
    line-height: 22px;
    transition: background-color 160ms ease, transform 160ms ease;
  }

  button:hover { background: var(--coral); }

  button:active { transform: translateY(1px); }

  :focus-visible {
    outline: 3px solid #fff;
    outline-offset: 4px;
  }

  input:focus-visible {
    outline: 3px solid var(--coral);
    outline-offset: 2px;
  }

  .help a:focus-visible { outline-color: var(--ink); }

  .help {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }

  .help h2 {
    margin: 0;
    color: var(--ink);
    font-size: 18px;
    font-weight: 800;
    letter-spacing: -0.015em;
    line-height: 24px;
  }

  .help ol {
    margin: 10px 0 0;
    padding-left: 21px;
    color: var(--muted-ink);
    font-size: 14px;
    line-height: 21px;
  }

  .help li + li { margin-top: 4px; }

  .help a {
    display: inline-block;
    margin-top: 12px;
    color: var(--ink);
    font-size: 14px;
    font-weight: 800;
    line-height: 20px;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }

  .page-notice {
    max-width: 560px;
    margin: 12px auto 0;
    color: rgba(255, 255, 255, 0.86);
    font-size: 12px;
    line-height: 18px;
    text-align: center;
  }

  .card__footer {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    color: var(--muted-ink);
    font-size: 13px;
    line-height: 19px;
  }

  .status-mark {
    display: grid;
    width: 56px;
    height: 56px;
    margin: 0 auto 20px;
    place-items: center;
    border-radius: 50%;
    color: #fff;
    background: var(--ink);
    font-size: 28px;
    font-weight: 800;
    line-height: 1;
  }

  .status-mark--failure { color: var(--ink); background: #ffe1d5; }

  .card--status p {
    max-width: 470px;
    margin: 12px auto 0;
    color: var(--muted-ink);
    font-size: 16px;
    line-height: 24px;
  }

  .card--status h1 {
    color: var(--ink);
    font-family: inherit;
    font-size: 28px;
    letter-spacing: -0.025em;
    line-height: 34px;
    text-transform: none;
    white-space: normal;
  }

  @media (max-width: 740px) {
    .page-shell { padding-right: 20px; padding-left: 20px; }
  }

  @media (max-width: 520px) {
    .page-shell { padding-top: 32px; padding-bottom: 32px; }
    .page-content { margin-top: 40px; }
    h1 { font-size: 38px; white-space: normal; }
    .card { margin-top: 20px; padding: 28px 22px; }
  }

  @media (max-width: 370px) {
    .page-shell { padding-right: 16px; padding-left: 16px; }
    .brand { gap: 7px; }
    .brand__skills { padding-right: 10px; padding-left: 10px; font-size: 13px; }
    h1 { font-size: 32px; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
  }
`;

function page(title, body) {
  return [
    "<!doctype html>",
    '<html lang="ru">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<style>${PAGE_STYLE}</style>`,
    "</head>",
    "<body>",
    '<div class="page-shell">',
    '<header class="brand" role="img" aria-label="Яндекс KIT Скилы">',
    `<span class="brand__logo" aria-hidden="true"><img src="${LOGO_DATA_URI}" alt=""></span>`,
    '<span class="brand__skills">Скилы</span>',
    "</header>",
    '<main class="page-content">',
    body,
    "</main>",
    "</div>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// The secret is base64url (A-Za-z0-9, "-", "_"), so it is safe to place in an
// HTML attribute without escaping. No user-controlled text ever reaches the
// markup: error messages are fixed strings chosen by code below.
const CABINET_URL = "https://b2b.kit.yandex.ru/";

function formPage(secret, errorMessage, mode = "connect") {
  const replacing = mode === "replace";
  const heading = replacing ? "Обновите токен" : "Подключите магазин";
  const submitLabel = replacing ? "Обновить" : "Подключить";
  const errorMarkup = errorMessage
    ? `<p id="token-error" class="error" role="alert">${errorMessage}</p>`
    : "";
  const describedBy = errorMessage ? ' aria-describedby="token-error"' : "";
  return page(
    heading,
    [
      '<section class="hero" aria-labelledby="page-heading">',
      `<h1 id="page-heading">${heading}</h1>`,
      "</section>",
      '<section class="card">',
      '<label id="token-label" class="field-label" for="token">Токен</label>',
      errorMarkup,
      `<form method="post" action="/?secret=${secret}">`,
      '<input id="token" name="token" type="password" ' +
        'autocomplete="off"' +
        describedBy +
        " " +
        `aria-invalid="${errorMessage ? "true" : "false"}" required>`,
      replacing
        ? '<p class="card__consequence">Новый токен заменит сохранённый.</p>'
        : "",
      `<button type="submit">${submitLabel}</button>`,
      "</form>",
      '<p class="card__privacy">Токен сохранится в настройках ассистента на этом компьютере, ' +
        'а не в переписке.</p>',
      '<div class="help" aria-labelledby="help-heading">',
      '<h2 id="help-heading">Где взять токен</h2>',
      "<ol>",
      "<li>В кабинете Яндекс KIT откройте Настройки → API.</li>",
      "<li>Нажмите «Сгенерировать токен» и скопируйте его.</li>",
      "</ol>",
      `<a href="${CABINET_URL}" target="_blank" rel="noreferrer noopener">Открыть кабинет ↗</a>`,
      "</div>",
      "</section>",
      '<p class="page-notice">Не передавайте ссылку на эту страницу.</p>',
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

const INVALID_TOKEN_MESSAGE =
  "Яндекс KIT не принял этот токен. Проверьте, что ключ скопирован " +
  "целиком, и попробуйте ещё раз.";
const EMPTY_TOKEN_MESSAGE = "Вставьте токен — поле не может быть пустым.";
const BUSY_MESSAGE =
  "Предыдущий токен ещё проверяется — подождите несколько секунд.";

function donePage() {
  return page(
    "Токен сохранён",
    [
      '<section class="card card--status" aria-labelledby="status-heading">',
      '<div class="status-mark" aria-hidden="true">✓</div>',
      '<h1 id="status-heading">Токен сохранён</h1>',
      "<p>Вернитесь в чат — ассистент завершит проверку подключения.</p>",
      "</section>",
    ].join("\n"),
  );
}

function failurePage() {
  return page(
    "Не удалось сохранить токен",
    [
      '<section class="card card--status" aria-labelledby="status-heading">',
      '<div class="status-mark status-mark--failure" aria-hidden="true">!</div>',
      '<h1 id="status-heading">Не удалось сохранить токен</h1>',
      "<p>Вернитесь в чат и попробуйте снова.</p>",
      "</section>",
    ].join("\n"),
  );
}

// Serves the one-time local token page on an ephemeral loopback port.
// validateToken and persistToken are injected so this module never touches
// the network or a client config itself: the caller wires in the real MCP
// smoke test and the real configuration write, and tests wire in stubs.
// The returned `done` settles once — with { validated, persisted } after the
// first successful save, or with a SetupError (TOKEN_WEB_TIMEOUT,
// TOKEN_WEB_ABUSE, TOKEN_WEB_CLOSED, or the validation/persistence failure).
// The token from the form only ever flows into those two callbacks — it is
// never logged, echoed, or embedded in an error message.
export async function startTokenWeb({
  validateToken,
  persistToken,
  timeoutSeconds = DEFAULT_TOKEN_WEB_TIMEOUT_SECONDS,
  mode = "connect",
  maxRejectedRequests = MAX_REJECTED_REQUESTS,
  maxBodyBytes = MAX_BODY_BYTES,
} = {}) {
  if (
    typeof validateToken !== "function" ||
    typeof persistToken !== "function"
  ) {
    throw new SetupError(
      "The token page requires validateToken and persistToken functions.",
      "USAGE",
    );
  }
  if (mode !== "connect" && mode !== "replace") {
    throw new SetupError(
      "The token page mode must be connect or replace.",
      "USAGE",
    );
  }
  const seconds = Number(timeoutSeconds);
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > MAX_TOKEN_WEB_TIMEOUT_SECONDS
  ) {
    throw new SetupError(
      `--timeout-seconds must be a number between 1 and ${MAX_TOKEN_WEB_TIMEOUT_SECONDS}.`,
      "USAGE",
    );
  }

  const secret = randomBytes(32).toString("base64url");
  let allowedHosts = new Set();
  let rejectedRequests = 0;
  let submitting = false;
  let phase = "acquiring";
  let accepting = true;
  let settled = false;
  let serverClosed = false;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // The page can fail between two of the caller's awaits (a rejected request
  // budget, the deadline). A pre-attached no-op handler keeps that rejection
  // from crashing the process before the caller reads `done`.
  done.catch(() => {});

  let deadlineTimer;
  const closeServer = ({ force = false } = {}) => {
    if (!serverClosed) {
      serverClosed = true;
      server.close(() => {});
    }
    // Keep active responses alive so the normal success page can flush, while
    // releasing idle keep-alive sockets as soon as the server stops accepting.
    server.closeIdleConnections?.();
    if (force) server.closeAllConnections?.();
  };

  const finish = (error, result, response) => {
    if (settled) return;
    settled = true;
    accepting = false;
    clearTimeout(deadlineTimer);

    const responseOpen =
      response && !response.destroyed && !response.writableFinished;
    if (responseOpen) {
      let cleanupTimer = setTimeout(
        () => closeServer({ force: true }),
        RESPONSE_CLEANUP_TIMEOUT_MS,
      );
      cleanupTimer.unref();
      const cleanup = () => {
        clearTimeout(cleanupTimer);
        cleanupTimer = undefined;
        closeServer({ force: true });
      };
      response.once("finish", cleanup);
      response.once("close", cleanup);
      closeServer();
    } else {
      closeServer({ force: true });
    }

    if (error) rejectDone(error);
    else resolveDone(result);
  };

  const stopAcquisition = (error) => {
    accepting = false;
    if (phase === "persisting") {
      // A save is a commit: stop new intake, then let the in-flight write own
      // the eventual result and its cleanup.
      closeServer();
      return;
    }
    finish(error);
  };

  const sendHtml = (res, status, html) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  };

  const completeWithPage = (res, status, html, error, result) => {
    const responseOpen = res && !res.destroyed && !res.writableEnded;
    finish(error, result, responseOpen ? res : undefined);
    if (responseOpen) {
      // The browser can close the socket between the check and res.end().
      // Its delivery failure must not replace the already settled outcome.
      try {
        sendHtml(res, status, html);
      } catch {
        // The response is best-effort once the factual result is settled.
        closeServer({ force: true });
      }
    }
  };

  // Every rejected request counts toward one shared budget: wrong or missing
  // secret, foreign Host, oversized body, unexpected path or method. Past the
  // budget the server assumes it is being probed and stops for good.
  const deny = (res, status) => {
    rejectedRequests += 1;
    const overBudget = rejectedRequests >= maxRejectedRequests;
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not available.", () => {
      if (overBudget) {
        stopAcquisition(
          new SetupError(
            `The token page stopped after ${maxRejectedRequests} rejected requests.`,
            "TOKEN_WEB_ABUSE",
          ),
        );
      }
    });
  };

  const handleSubmission = async (token, res) => {
    if (submitting) {
      sendHtml(res, 200, formPage(secret, BUSY_MESSAGE, mode));
      return;
    }
    if (!token) {
      sendHtml(res, 200, formPage(secret, EMPTY_TOKEN_MESSAGE, mode));
      return;
    }
    submitting = true;
    try {
      const validated = await validateToken(token);
      if (settled) return;
      // Validation before persistence is the repository invariant: a token
      // that fails the live get_store check never reaches a client config.
      phase = "persisting";
      clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
      const persisted = await persistToken(token);
      if (settled) return;
      completeWithPage(
        res,
        200,
        donePage(),
        null,
        { validated, persisted },
      );
    } catch (error) {
      if (settled) return;
      if (
        phase === "acquiring" &&
        error instanceof SetupError &&
        error.code === "SMOKE_AUTH"
      ) {
        // A wrong token is the owner's normal retry loop — show the form
        // again with a fixed message and keep the page alive, unlimited.
        submitting = false;
        sendHtml(res, 200, formPage(secret, INVALID_TOKEN_MESSAGE, mode));
        return;
      }
      // Anything else (network, timeout, write failure) ends the run with
      // the underlying code. The page shows a fixed text without details so
      // no diagnostic — let alone the token — leaks into the browser.
      completeWithPage(
        res,
        200,
        failurePage(),
        error instanceof Error
          ? error
          : new SetupError(String(error), "TOKEN_WEB_FAILED"),
        undefined,
      );
    }
  };

  const handler = (req, res) => {
    res.on("error", () => {});
    if (!accepting) {
      req.socket.destroy();
      return;
    }
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }
    res.setHeader("Connection", "close");

    if (!LOOPBACK_PEERS.has(req.socket.remoteAddress)) {
      req.socket.destroy();
      return;
    }
    const host = String(req.headers.host || "").toLowerCase();
    if (!allowedHosts.has(host)) {
      deny(res, 421);
      return;
    }
    let requestUrl;
    try {
      requestUrl = new URL(req.url, "http://127.0.0.1");
    } catch {
      deny(res, 400);
      return;
    }
    if (requestUrl.pathname !== "/") {
      deny(res, 404);
      return;
    }
    if (!secretMatches(secret, requestUrl.searchParams.get("secret") || "")) {
      deny(res, 404);
      return;
    }
    if (req.method === "GET") {
      sendHtml(res, 200, formPage(secret, null, mode));
      return;
    }
    if (req.method !== "POST") {
      deny(res, 405);
      return;
    }

    // The token travels only in the POST body, never in a URL, so it cannot
    // land in browser history or a proxy log even on this loopback hop.
    const chunks = [];
    let received = 0;
    let overflow = false;
    req.on("error", () => {});
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBodyBytes) {
        overflow = true;
        req.removeAllListeners("data");
        req.resume();
        deny(res, 413);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflow || settled) return;
      const body = Buffer.concat(chunks).toString("utf8");
      const token = (new URLSearchParams(body).get("token") || "").trim();
      handleSubmission(token, res);
    });
  };

  const server = http.createServer(handler);
  // No request logging anywhere: malformed clients are dropped silently.
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  allowedHosts = new Set([
    "127.0.0.1",
    `127.0.0.1:${port}`,
    "localhost",
    `localhost:${port}`,
    "[::1]",
    `[::1]:${port}`,
  ]);

  deadlineTimer = setTimeout(() => {
    stopAcquisition(
      new SetupError(
        `The token page expired after ${seconds} seconds without a saved token.`,
        "TOKEN_WEB_TIMEOUT",
      ),
    );
  }, seconds * 1000);
  deadlineTimer.unref();

  return {
    url: `http://127.0.0.1:${port}/?secret=${secret}`,
    port,
    expiresInSeconds: seconds,
    done,
    stop: () =>
      stopAcquisition(new SetupError("The token page was closed.", "TOKEN_WEB_CLOSED")),
  };
}
