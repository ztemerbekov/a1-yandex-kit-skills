---
name: verify
description: How to verify changes to the a1-yandex-kit-setup helper CLI at its real surface (setup.mjs), including the no-network sandbox scenario.
---

# Verifying the setup helper CLI

The surface is `node skills/a1-yandex-kit-setup/scripts/setup.mjs <command>`.
No build step — plain Node 20+, no dependencies.

## Recipes that work

- **stdin protocol (no-EOF regression):** feed the token through a FIFO and
  keep the write end open; the helper must exit on its own:

  ```bash
  mkfifo "$TMP/pipe"
  node .../setup.mjs configure --client cursor --config "$TMP/mcp.json" --token-stdin --json < "$TMP/pipe" &
  exec 3>"$TMP/pipe"; printf 'token\n' >&3; wait $!   # exits ~0.3s
  ```

  Do not time `(printf ...; sleep N) | node ...` — the pipeline waits for the
  sleep, not the helper.

- **Live smoke without a real token:** `printf 'bad\n' | node .../setup.mjs
  smoke-token --token-stdin --json` runs real npx + mcp-yandex-kit@latest +
  the real API and must return `SMOKE_AUTH` in ~3s. Read-only, safe.

- **No-network sandbox (the Codex scenario, macOS):**

  ```bash
  printf 'bad\n' | sandbox-exec -p '(version 1)(allow default)(deny network*)' \
    node .../setup.mjs smoke-token --token-stdin --json
  ```

  Must return `NETWORK_UNAVAILABLE` in <1s. `sandbox-exec` is deprecated but
  works; the Claude Bash sandbox itself has network, so it can't provide this.

- **Orphan check after any smoke:** `pgrep -fl mcp-yandex-kit` → empty.

## Gotchas

- A verifiable happy path needs a valid `YANDEX_KIT_TOKEN`; without one the
  furthest observable live state is `SMOKE_AUTH` (which still proves probe,
  spawn, handshake, get_store and cleanup).
- `configure` needs no network at all — only `npx --version` locally.
