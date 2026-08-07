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

test("a configured server loads without throwing", () => {
  assert.equal(loadConfig({ YANDEX_KIT_TOKEN: "t0ken" }).rps, 3);
});
