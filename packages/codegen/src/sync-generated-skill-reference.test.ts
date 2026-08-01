import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { syncGeneratedSkillReference } from "./sync-generated-skill-reference.js";

const relativePath = "references/exact-write-protocol.md";
const generatedHeader = "<!-- generated; do not edit -->\n\n";

function writeFixture(root: string, relativeFile: string, contents: string): void {
  const file = join(root, relativeFile);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

test("syncs declared consumers and removes only generator-owned orphan copies", () => {
  const root = mkdtempSync(join(tmpdir(), "a1-skill-reference-"));
  try {
    writeFixture(
      root,
      "consumer/SKILL.md",
      "Read [the protocol]( references/exact-write-protocol.md ).\n",
    );
    writeFixture(root, "orphan/SKILL.md", "# No dependency\n");
    writeFixture(root, `orphan/${relativePath}`, generatedHeader + "old\n");
    writeFixture(root, "orphan/references/keep.md", "manual reference\n");
    writeFixture(root, "manual-orphan/SKILL.md", "# No dependency\n");
    writeFixture(root, `manual-orphan/${relativePath}`, "manual protocol\n");

    const consumers = syncGeneratedSkillReference({
      skillsDir: root,
      relativePath,
      generatedHeader,
      source: "# Canonical protocol\n",
    });

    assert.deepEqual(consumers, ["consumer"]);
    assert.equal(
      readFileSync(join(root, "consumer", relativePath), "utf8"),
      generatedHeader + "# Canonical protocol\n",
    );
    assert.equal(existsSync(join(root, "orphan", relativePath)), false);
    assert.equal(
      readFileSync(join(root, "orphan/references/keep.md"), "utf8"),
      "manual reference\n",
    );
    assert.equal(
      readFileSync(join(root, "manual-orphan", relativePath), "utf8"),
      "manual protocol\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses to overwrite a consumer copy without the generated header", () => {
  const root = mkdtempSync(join(tmpdir(), "a1-skill-reference-"));
  try {
    writeFixture(
      root,
      "consumer/SKILL.md",
      "Read [the protocol](references/exact-write-protocol.md).\n",
    );
    writeFixture(root, `consumer/${relativePath}`, "manual protocol\n");

    assert.throws(
      () =>
        syncGeneratedSkillReference({
          skillsDir: root,
          relativePath,
          generatedHeader,
          source: "# Canonical protocol\n",
        }),
      /Refusing to overwrite non-generated/u,
    );
    assert.equal(
      readFileSync(join(root, "consumer", relativePath), "utf8"),
      "manual protocol\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository copies match every SKILL.md declaration and have no generated orphans", () => {
  const source = readFileSync(
    new URL("./skill-src/references/exact-write-protocol.md", import.meta.url),
    "utf8",
  );
  const repositoryHeader =
    "<!-- Generated from packages/codegen/src/skill-src/references/exact-write-protocol.md; do not edit. -->\n\n";
  const skillsRoot = new URL("../../../skills/", import.meta.url);
  const declaredConsumers: string[] = [];
  const generatedCopies: string[] = [];

  assert.match(source, /A normal exact change is a one-stage plan/u);
  assert.match(source, /Run a dependent stage only after/u);
  assert.match(source, /report the plan as \*\*partial\*\*/u);

  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const skillMdPath = new URL(`${entry.name}/SKILL.md`, skillsRoot);
    const copyPath = new URL(
      `${entry.name}/references/exact-write-protocol.md`,
      skillsRoot,
    );

    if (
      existsSync(skillMdPath) &&
      /\]\(\s*references\/exact-write-protocol\.md\s*\)/u.test(
        readFileSync(skillMdPath, "utf8"),
      )
    ) {
      declaredConsumers.push(entry.name);
    }
    if (
      existsSync(copyPath) &&
      readFileSync(copyPath, "utf8").startsWith(repositoryHeader)
    ) {
      generatedCopies.push(entry.name);
    }
  }

  assert.ok(
    declaredConsumers.length > 0,
    "at least one skill must declare the protocol",
  );
  assert.deepEqual(generatedCopies, declaredConsumers);
  for (const skill of declaredConsumers) {
    const copy = readFileSync(
      new URL(`${skill}/references/exact-write-protocol.md`, skillsRoot),
      "utf8",
    );
    assert.equal(copy, repositoryHeader + source, skill);
  }
});
