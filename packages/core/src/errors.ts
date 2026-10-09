/**
 * Error types for the Yandex KIT API client.
 *
 * The API error contract (verified live) is a JSON body:
 *   {"code": "...", "message": "...", "trace_id": "..."}
 */

/** HTTP-level error returned by the KIT API. */
export interface KitRequestContext {
  operationId?: string;
  method: string;
  attempted: true;
}

export interface KitMutationUncertainty {
  mutationOutcome: "unknown";
  readbackRequired: true;
  repeatPolicy: "do_not_repeat";
}

export class KitApiError extends Error {
  status: number;
  code: string;
  traceId?: string;
  details?: unknown;
  requestContext?: KitRequestContext;
  mutationOutcome?: KitMutationUncertainty["mutationOutcome"];
  readbackRequired?: KitMutationUncertainty["readbackRequired"];
  repeatPolicy?: KitMutationUncertainty["repeatPolicy"];

  constructor(
    status: number,
    code: string,
    message: string,
    traceId?: string,
    details?: unknown,
    requestContext?: KitRequestContext,
    uncertainty?: KitMutationUncertainty,
  ) {
    super(message);
    this.name = "KitApiError";
    this.status = status;
    this.code = code;
    this.traceId = traceId;
    this.details = details;
    this.requestContext = requestContext;
    this.mutationOutcome = uncertainty?.mutationOutcome;
    this.readbackRequired = uncertainty?.readbackRequired;
    this.repeatPolicy = uncertainty?.repeatPolicy;
  }
}

/** Client-side validation error raised before any network call. */
export class KitValidationError extends Error {
  errors: string[];
  /** Stable machine-readable reason; safe to assert on (messages are not). */
  code: string;

  constructor(message: string, errors: string[] = [], code = "LOCAL_VALIDATION_ERROR") {
    super(message);
    this.name = "KitValidationError";
    this.errors = errors.length > 0 ? errors : [message];
    this.code = code;
  }
}
