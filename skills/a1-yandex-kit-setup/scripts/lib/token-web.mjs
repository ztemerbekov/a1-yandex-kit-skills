import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";

import { SetupError } from "./shared.mjs";

export const DEFAULT_TOKEN_WEB_TIMEOUT_SECONDS = 300;
export const MAX_TOKEN_WEB_TIMEOUT_SECONDS = 3600;
const MAX_BODY_BYTES = 8192;
const MAX_REJECTED_REQUESTS = 20;
const RESPONSE_CLEANUP_TIMEOUT_MS = 1_000;

// The token arrives over plain loopback HTTP, so the page defends in depth:
// requests must come from a loopback peer, name a loopback Host (a browser
// lured to attacker.example resolving to 127.0.0.1 sends its own Host — this
// check breaks DNS rebinding), and present the one-time secret. The page
// itself may load nothing from the network and may never be framed.
const LOOPBACK_PEERS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; " +
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
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; display: flex;
    justify-content: center; padding: 48px 16px; }
  main { max-width: 440px; width: 100%; }
  h1 { font-size: 1.5rem; }
  label { font-weight: 600; }
  input { width: 100%; box-sizing: border-box; font-size: 1rem;
    padding: 10px 12px; margin: 8px 0 16px; }
  button { font-size: 1rem; padding: 10px 24px; cursor: pointer; }
  .error { color: #b3261e; font-weight: 600; }
  footer { margin-top: 32px; font-size: 0.85rem; opacity: 0.75; }
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
    "<main>",
    body,
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// The secret is base64url (A-Za-z0-9, "-", "_"), so it is safe to place in an
// HTML attribute without escaping. No user-controlled text ever reaches the
// markup: error messages are fixed strings chosen by code below.
function formPage(secret, errorMessage) {
  return page(
    "Подключение магазина",
    [
      "<h1>Подключение магазина</h1>",
      "<p>Вставьте токен магазина Яндекс KIT — после этого ассистент " +
        "сможет работать с вашим магазином.</p>",
      errorMessage ? `<p class="error">${errorMessage}</p>` : "",
      `<form method="post" action="/?secret=${secret}">`,
      '<label for="token">Токен магазина</label>',
      '<input id="token" name="token" type="password" ' +
        'placeholder="Вставьте токен из кабинета Яндекс KIT" ' +
        'autocomplete="off" autofocus required>',
      '<button type="submit">Подключить</button>',
      "</form>",
      "<footer>",
      "<p>Где взять токен: кабинет Яндекс KIT, Настройки → API → " +
        "«Сгенерировать токен».</p>",
      "<p>Токен остаётся на этом компьютере и не попадает в переписку " +
        "с ассистентом.</p>",
      "<p>Страница одноразовая — никому не передавайте ссылку на неё.</p>",
      "</footer>",
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
    "Готово",
    [
      "<h1>Готово</h1>",
      "<p>Токен проверен и сохранён — магазин подключён.</p>",
      "<p>Вернитесь в диалог с ассистентом. Эту страницу можно закрыть.</p>",
    ].join("\n"),
  );
}

function failurePage() {
  return page(
    "Подключение прервано",
    [
      "<h1>Подключение прервано</h1>",
      "<p>Не получилось проверить токен из-за технической ошибки.</p>",
      "<p>Вернитесь в диалог с ассистентом — он подскажет следующий шаг.</p>",
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
      sendHtml(res, 200, formPage(secret, BUSY_MESSAGE));
      return;
    }
    if (!token) {
      sendHtml(res, 200, formPage(secret, EMPTY_TOKEN_MESSAGE));
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
        sendHtml(res, 200, formPage(secret, INVALID_TOKEN_MESSAGE));
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
      sendHtml(res, 200, formPage(secret, null));
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
