import { test } from "node:test";
import assert from "node:assert/strict";

import { ConfigError, loadConfig } from "./config.js";

/**
 * The reason codes below are the vocabulary the usage dashboard groups by —
 * renaming one silently splits a bar in two, so they are pinned here.
 */
function reasonOf(env: NodeJS.ProcessEnv): string {
  try {
    loadConfig(env);
  } catch (err) {
    assert.ok(err instanceof ConfigError, "config problems must throw ConfigError, not exit");
    return err.reason;
  }
  throw new assert.AssertionError({ message: "loadConfig was expected to throw" });
}

test("a missing token reports missing_token", () => {
  assert.equal(reasonOf({}), "missing_token");
});

test("a malformed numeric setting reports invalid_config", () => {
  assert.equal(reasonOf({ YANDEX_KIT_TOKEN: "t0ken", YANDEX_KIT_RPS: "-1" }), "invalid_config");
});

test("a malformed base URL reports invalid_config at startup, not on the first call", () => {
  assert.equal(
    reasonOf({ YANDEX_KIT_TOKEN: "t0ken", YANDEX_KIT_BASE_URL: "not a url" }),
    "invalid_config",
  );
  assert.equal(
    reasonOf({ YANDEX_KIT_TOKEN: "t0ken", YANDEX_KIT_BASE_URL: "ftp://api.example" }),
    "invalid_config",
  );
});

test("base URL error messages never echo the value (it can carry credentials)", () => {
  // ftp:// guarantees the throw, with a secret in the rejected value.
  try {
    loadConfig({ YANDEX_KIT_TOKEN: "t0ken", YANDEX_KIT_BASE_URL: "ftp://user:secret@x/" });
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.ok(!err.message.includes("secret"), "the URL value must not leak into the message");
    return;
  }
  throw new assert.AssertionError({ message: "loadConfig was expected to throw" });
});

test("a configured server loads without throwing", () => {
  assert.equal(loadConfig({ YANDEX_KIT_TOKEN: "t0ken" }).rps, 3);
  assert.equal(
    loadConfig({ YANDEX_KIT_TOKEN: "t0ken", YANDEX_KIT_BASE_URL: "https://api.example" }).baseUrl,
    "https://api.example",
  );
});
