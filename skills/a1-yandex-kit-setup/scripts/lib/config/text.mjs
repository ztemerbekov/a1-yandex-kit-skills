import { SetupError } from "../shared.mjs";

export function stripCommentOutsideQuotes(value, configPath, syntax) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote === "'" && char === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      continue;
    }
    if (char === "#" && !quote) return value.slice(0, index).trimEnd();
  }
  if (quote || escaped) {
    throw new SetupError(
      `Cannot safely parse ${syntax} config at ${configPath}: unterminated string.`,
      "MALFORMED_CONFIG",
    );
  }
  return value.trimEnd();
}
