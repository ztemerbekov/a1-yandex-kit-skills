import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface GeneratedSkillReference {
  skillsDir: string;
  relativePath: string;
  generatedHeader: string;
  source: string;
}

function exactMarkdownLinkPattern(target: string): RegExp {
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\]\\(\\s*${escapedTarget}\\s*\\)`, "u");
}

/**
 * Treats an exact Markdown link in SKILL.md as the dependency declaration.
 * Generator-owned copies follow that declaration; files without the generated
 * header are never overwritten or removed.
 */
export function syncGeneratedSkillReference({
  skillsDir,
  relativePath,
  generatedHeader,
  source,
}: GeneratedSkillReference): string[] {
  const pathSegments = relativePath.split("/");
  if (
    pathSegments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) ||
    generatedHeader.length === 0
  ) {
    throw new Error(
      "Generated skill reference requires a safe relative path and non-empty header",
    );
  }

  const declaration = exactMarkdownLinkPattern(relativePath);
  const generatedCopy = generatedHeader + source;
  const consumers: string[] = [];

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const skillDir = join(skillsDir, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");
    const copyPath = join(skillDir, ...pathSegments);
    const declaresReference =
      existsSync(skillMdPath) && declaration.test(readFileSync(skillMdPath, "utf8"));

    if (declaresReference) {
      if (existsSync(copyPath)) {
        const existingCopy = readFileSync(copyPath, "utf8");
        if (!existingCopy.startsWith(generatedHeader)) {
          throw new Error(
            `Refusing to overwrite non-generated ${relativePath} in ${entry.name}`,
          );
        }
      }
      mkdirSync(dirname(copyPath), { recursive: true });
      writeFileSync(copyPath, generatedCopy);
      consumers.push(entry.name);
      continue;
    }

    if (
      existsSync(copyPath) &&
      readFileSync(copyPath, "utf8").startsWith(generatedHeader)
    ) {
      rmSync(copyPath);
    }
  }

  return consumers;
}
