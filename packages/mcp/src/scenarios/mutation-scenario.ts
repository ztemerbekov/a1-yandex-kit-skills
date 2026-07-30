export type MutationOutcomeKind = "completed" | "failed" | "ambiguous";

export interface MutationOutcome {
  kind: MutationOutcomeKind;
  message: string;
}

export function isKitObjectId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

export function mutationResultIsAmbiguous(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status =
    "status" in error && typeof error.status === "number"
      ? error.status
      : "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
  return (
    status === 408 ||
    (status !== undefined && status >= 500) ||
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    error instanceof TypeError ||
    /timeout|timed out|network|fetch failed|aborted|http\s*5\d\d|status(?: code)?\s*[:=]?\s*5\d\d/iu.test(
      error.message,
    )
  );
}

export async function executeVerifiedMutation<T>({
  subject,
  initialBefore,
  read,
  validateBefore,
  write,
  verifyAfter,
}: {
  subject: string;
  initialBefore?: T;
  read: () => Promise<T>;
  validateBefore?: (before: T) => string | undefined;
  write: (before: T) => Promise<unknown>;
  verifyAfter: (after: T, before: T) => { valid: boolean; message: string };
}): Promise<MutationOutcome> {
  let before: T;
  if (initialBefore !== undefined) {
    before = initialBefore;
  } else {
    try {
      before = await read();
    } catch (error) {
      return {
        kind: "failed",
        message: `${subject}: чтение не удалось — ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const preconditionFailure = validateBefore?.(before);
  if (preconditionFailure) return { kind: "failed", message: `${subject}: ${preconditionFailure}` };

  let writeError: unknown;
  try {
    await write(before);
  } catch (error) {
    writeError = error;
  }

  let after: T;
  try {
    after = await read();
  } catch (error) {
    return {
      kind: "ambiguous",
      message:
        `${subject}: операция записи вызвана один раз, повторное чтение не удалось ` +
        `(${error instanceof Error ? error.message : String(error)}); результат неизвестен, нужна проверка`,
    };
  }

  if (writeError) {
    const message = writeError instanceof Error ? writeError.message : String(writeError);
    if (mutationResultIsAmbiguous(writeError)) {
      return {
        kind: "ambiguous",
        message:
          `${subject}: операция записи вызвана один раз и завершилась ошибкой «${message}»; ` +
          "результат неизвестен, нужна проверка",
      };
    }
    return { kind: "failed", message: `${subject}: ${message}` };
  }

  const verification = verifyAfter(after, before);
  return {
    kind: verification.valid ? "completed" : "ambiguous",
    message: verification.valid
      ? verification.message
      : `${verification.message}; повторное чтение не подтвердило запись, результат неизвестен, нужна проверка`,
  };
}
