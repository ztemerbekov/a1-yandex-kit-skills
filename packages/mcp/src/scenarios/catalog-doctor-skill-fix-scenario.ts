import type { CatalogVariant } from "./catalog-doctor-skill-scenario.js";

// Deterministic exact-write reference model for the Catalog Doctor skill.
import {
  executeVerifiedMutation,
  isKitObjectId,
  mutationResultIsAmbiguous,
  type MutationOutcome,
  type MutationOutcomeKind,
} from "./skill-mutation-protocol.js";

export const CATALOG_FIX_BATCH_LIMIT = 100;
export const CATALOG_VIDEO_POLL_LIMIT = 60;
export const CATALOG_VIDEO_POLL_INTERVAL_MS = 5_000;

type CatalogVideoStatus = "UPLOADED" | "PROCESSING" | "READY" | "ERROR";

interface CatalogDoctorFixToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

const READ_TOOLS = new Set(["list_variants", "get_variant", "get_video"]);

function notFound(message: string): Error {
  const error = new Error(message);
  error.name = "NotFoundError";
  return error;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "NotFoundError";
}

function cloneVariant(variant: CatalogVariant): CatalogVariant {
  return structuredClone(variant);
}

export class FakeCatalogDoctorFixMcp {
  readonly calls: CatalogDoctorFixToolCall[] = [];
  readonly videoPollDelays: number[] = [];
  readonly #variants = new Map<string, CatalogVariant>();
  readonly #listVariants: CatalogVariant[] | undefined;
  readonly #mutationErrors: Record<string, Error>;
  readonly #readErrors: Record<string, Error>;
  readonly #uploadedVideoId: string;
  readonly #videoStatusSequence: CatalogVideoStatus[];
  #videoStatusIndex = 0;
  finalAnswer: string | undefined;

  constructor({
    variants,
    listVariants,
    mutationErrors = {},
    readErrors = {},
    uploadedVideoId = "video-from-url",
    videoStatusSequence = ["READY"],
  }: {
    variants: CatalogVariant[];
    listVariants?: CatalogVariant[];
    mutationErrors?: Record<string, Error>;
    readErrors?: Record<string, Error>;
    uploadedVideoId?: string;
    videoStatusSequence?: CatalogVideoStatus[];
  }) {
    for (const variant of variants) {
      this.#variants.set(variant.id, cloneVariant(variant));
    }
    this.#listVariants = listVariants?.map(cloneVariant);
    this.#mutationErrors = mutationErrors;
    this.#readErrors = readErrors;
    this.#uploadedVideoId = uploadedVideoId;
    this.#videoStatusSequence = [...videoStatusSequence];
  }

  get writeCalls(): CatalogDoctorFixToolCall[] {
    return this.calls.filter(
      (call) =>
        !READ_TOOLS.has(call.name) &&
        !(
          call.name === "kit_request" &&
          String(call.arguments.operation_id).startsWith("Get")
        ),
    );
  }

  variantById(id: string): CatalogVariant | undefined {
    const variant = this.#variants.get(id);
    return variant ? cloneVariant(variant) : undefined;
  }

  async call(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, arguments: structuredClone(arguments_) });

    if (name === "list_variants") {
      const page =
        typeof arguments_.page === "number" ? arguments_.page : 1;
      const preparedError =
        this.#readErrors[`list_variants:${page}`] ?? this.#readErrors.list_variants;
      if (preparedError) throw preparedError;
      const perPage =
        typeof arguments_.per_page === "number" ? arguments_.per_page : 100;
      const search = String(arguments_.name ?? "").toLowerCase();
      const statuses = new Set(
        Array.isArray(arguments_.status)
          ? arguments_.status.map(String)
          : ["PUBLISHED", "HIDDEN"],
      );
      const matches = (
        this.#listVariants ?? [...this.#variants.values()]
      ).filter(
        (variant) =>
          statuses.has(variant.status) &&
          (!search ||
            variant.id.toLowerCase().includes(search) ||
            variant.sku.toLowerCase().includes(search) ||
            variant.name.toLowerCase().includes(search)),
      );
      const start = (page - 1) * perPage;
      return {
        variants: matches.slice(start, start + perPage).map(cloneVariant),
        total_count: matches.length,
      };
    }

    if (name === "get_variant") {
      const id = String(arguments_.id);
      const variant = this.#variants.get(id);
      if (!variant) throw notFound(`Variant ${id} was not found`);
      return cloneVariant(variant);
    }

    if (name === "update_variant") {
      const id = String(arguments_.id);
      const current = this.#variants.get(id);
      if (!current) throw notFound(`Variant ${id} was not found`);
      const preparedError = this.#mutationErrors[`update_variant:${id}`];
      if (preparedError) throw preparedError;
      const patch = arguments_.variant as Partial<CatalogVariant> & {
        pricing?: CatalogVariant["pricing"];
      };
      this.#variants.set(id, {
        ...current,
        ...structuredClone(patch),
        pricing: patch.pricing
          ? { ...current.pricing, ...structuredClone(patch.pricing) }
          : current.pricing,
      });
      return this.variantById(id);
    }

    if (name === "upload_video_from_url") {
      const url = String(arguments_.url);
      const preparedError = this.#mutationErrors[`upload_video_from_url:${url}`];
      if (preparedError) throw preparedError;
      return { video_id: this.#uploadedVideoId };
    }

    if (name === "get_video") {
      const videoId = String(arguments_.video_id);
      const preparedError =
        this.#readErrors[`get_video:${videoId}:${this.#videoStatusIndex + 1}`] ??
        this.#readErrors[`get_video:${videoId}`];
      if (preparedError) throw preparedError;
      const status =
        this.#videoStatusSequence[
          Math.min(
            this.#videoStatusIndex,
            Math.max(0, this.#videoStatusSequence.length - 1),
          )
        ] ?? "PROCESSING";
      this.#videoStatusIndex += 1;
      return { id: videoId, status };
    }

    if (
      name === "kit_request" &&
      arguments_.operation_id === "DeleteVariant"
    ) {
      const pathParams = arguments_.path_params as
        | Record<string, unknown>
        | undefined;
      const id = String(pathParams?.id);
      const current = this.#variants.get(id);
      if (!current) throw notFound(`Variant ${id} was not found`);
      const preparedError = this.#mutationErrors[`DeleteVariant:${id}`];
      if (preparedError) throw preparedError;
      this.#variants.delete(id);
      return undefined;
    }

    throw new Error(`Unsupported FakeCatalogDoctorFixMcp tool: ${name}`);
  }

  async waitForVideoPollInterval(milliseconds: number): Promise<void> {
    this.videoPollDelays.push(milliseconds);
  }

  finish(report: string): void {
    this.finalAnswer = report;
  }
}

function formatOutcomes(outcomes: MutationOutcome[], batch = false): string {
  const sections: Array<{
    kind: MutationOutcomeKind;
    title: string;
  }> = [
    { kind: "completed", title: "Исправлено" },
    { kind: "failed", title: "Не исправлено" },
    { kind: "ambiguous", title: "Неоднозначно" },
  ];
  return [
    ...(batch
      ? [
          `Пакетный лимит: ${CATALOG_FIX_BATCH_LIMIT} объектов; обработка продолжена после локальных ошибок.`,
        ]
      : []),
    ...sections.map(({ kind, title }) => {
      const selected = outcomes.filter((outcome) => outcome.kind === kind);
      return [
        `${title} (${selected.length})`,
        ...selected.map((outcome) => `- ${outcome.message}.`),
      ].join("\n");
    }),
  ].join("\n\n");
}

function finish(
  mcp: FakeCatalogDoctorFixMcp,
  outcomes: MutationOutcome[],
  batch = false,
): { report: string } {
  const report = formatOutcomes(outcomes, batch);
  mcp.finish(report);
  return { report };
}

async function findExactVariant(
  mcp: FakeCatalogDoctorFixMcp,
  reference: string,
): Promise<CatalogVariant[]> {
  const found: CatalogVariant[] = [];
  let page = 1;
  let totalCount = 0;
  do {
    const response = (await mcp.call("list_variants", {
      name: reference,
      status: ["PUBLISHED", "HIDDEN", "ARCHIVED"],
      page,
      per_page: 100,
    })) as { variants: CatalogVariant[]; total_count: number };
    totalCount = response.total_count;
    found.push(...response.variants);
    if (response.variants.length === 0 && found.length < totalCount) {
      throw new Error(
        `Variant pagination stopped at ${found.length} of ${totalCount} on page ${page}`,
      );
    }
    page += 1;
  } while (found.length < totalCount);
  const normalized = reference.toLowerCase();
  const idMatches = found.filter((variant) => variant.id.toLowerCase() === normalized);
  return idMatches.length > 0
    ? idMatches
    : found.filter((variant) => variant.sku.toLowerCase() === normalized);
}

async function resolveOneVariant(
  mcp: FakeCatalogDoctorFixMcp,
  reference: string,
): Promise<
  | { variant: CatalogVariant; fromDetail: boolean }
  | { outcome: MutationOutcome }
> {
  if (isKitObjectId(reference)) {
    try {
      return {
        variant: (await mcp.call("get_variant", { id: reference })) as CatalogVariant,
        fromDetail: true,
      };
    } catch (error) {
      return {
        outcome: {
          kind: "failed",
          message:
            `SKU ${reference}: чтение явного ID не удалось — ` +
            `${error instanceof Error ? error.message : String(error)}; запись не выполняется`,
        },
      };
    }
  }
  let matches: CatalogVariant[];
  try {
    matches = await findExactVariant(mcp, reference);
  } catch (error) {
    return {
      outcome: {
        kind: "failed",
        message:
          `SKU ${reference}: разрешение цели не завершено — ` +
          `${error instanceof Error ? error.message : String(error)}; запись не выполняется`,
      },
    };
  }
  if (matches.length === 1) return { variant: matches[0]!, fromDetail: false };
  if (matches.length === 0) {
    return {
      outcome: {
        kind: "failed",
        message: `SKU ${reference}: точный объект не найден`,
      },
    };
  }
  return {
    outcome: {
      kind: "ambiguous",
      message: `SKU ${reference}: найдено несколько точных совпадений; укажите ID`,
    },
  };
}

async function executeVerifiedVariantMutation({
  mcp,
  variant,
  fromDetail,
  validate,
  write,
  verify,
}: {
  mcp: FakeCatalogDoctorFixMcp;
  variant: CatalogVariant;
  fromDetail: boolean;
  validate?: (before: CatalogVariant) => string | undefined;
  write: (before: CatalogVariant) => Promise<unknown>;
  verify: (
    after: CatalogVariant,
    before: CatalogVariant,
  ) => { valid: boolean; message: string };
}): Promise<MutationOutcome> {
  return executeVerifiedMutation({
    subject: `SKU ${variant.sku} (${variant.id})`,
    initialBefore: fromDetail ? variant : undefined,
    read: () =>
      mcp.call("get_variant", { id: variant.id }) as Promise<CatalogVariant>,
    validateBefore: validate,
    write,
    verifyAfter: verify,
  });
}

async function executePriceChange(
  mcp: FakeCatalogDoctorFixMcp,
  reference: string,
  price: string,
): Promise<MutationOutcome> {
  const resolved = await resolveOneVariant(mcp, reference);
  if ("outcome" in resolved) return resolved.outcome;
  return executeVerifiedVariantMutation({
    mcp,
    variant: resolved.variant,
    fromDetail: resolved.fromDetail,
    write: (before) =>
      mcp.call("update_variant", {
        id: before.id,
        variant: { pricing: { price } },
      }),
    verify: (after) => ({
      valid: after.pricing.price === price,
      message:
        after.pricing.price === price
          ? `SKU ${after.sku} (${after.id}): цена установлена ${price}`
          : `SKU ${after.sku} (${after.id}): ожидалась цена ${price}, прочитано ${after.pricing.price ?? "нет значения"}`,
    }),
  });
}

function normalizeDecimal(raw: string): string | undefined {
  const normalized = raw.replace(/[\s\u00a0]/gu, "").replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/u.test(normalized)) return undefined;
  return normalized;
}

function sameStocks(
  left: CatalogVariant["stocks"],
  right: CatalogVariant["stocks"],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameMedia(
  left: CatalogVariant["media"],
  right: CatalogVariant["media"],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function executeVideoFromUrlAddition(
  mcp: FakeCatalogDoctorFixMcp,
  reference: string,
  url: string,
  displaySequence: number,
): Promise<MutationOutcome> {
  const resolved = await resolveOneVariant(mcp, reference);
  if ("outcome" in resolved) return resolved.outcome;

  let before = resolved.variant;
  if (!resolved.fromDetail) {
    try {
      before = (await mcp.call("get_variant", {
        id: before.id,
      })) as CatalogVariant;
    } catch (error) {
      return {
        kind: "failed",
        message: `SKU ${before.sku} (${before.id}): чтение media не удалось — ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  if (!before.media.some((media) => media.type === "IMAGE" && media.image_id)) {
    return {
      kind: "failed",
      message: `SKU ${before.sku} (${before.id}): видео требует хотя бы одно пригодное изображение в media`,
    };
  }
  if (before.media.some((media) => media.type === "VIDEO")) {
    return {
      kind: "failed",
      message: `SKU ${before.sku} (${before.id}): видео уже существует; для замены нужно явное разрешение владельца`,
    };
  }
  if (
    before.media.some(
      (media) => media.display_sequence === displaySequence,
    )
  ) {
    return {
      kind: "failed",
      message: `SKU ${before.sku} (${before.id}): позиция ${displaySequence} уже занята; нужен точный порядок перемещения существующего media`,
    };
  }

  let uploaded: unknown;
  try {
    uploaded = await mcp.call("upload_video_from_url", { url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: mutationResultIsAmbiguous(error) ? "ambiguous" : "failed",
      message: `SKU ${before.sku} (${before.id}): загрузка видео вызвана один раз и завершилась ошибкой «${message}»; вариант не изменён`,
    };
  }
  const videoId =
    uploaded &&
    typeof uploaded === "object" &&
    "video_id" in uploaded &&
    typeof uploaded.video_id === "string"
      ? uploaded.video_id
      : undefined;
  if (!videoId) {
    return {
      kind: "failed",
      message: `SKU ${before.sku} (${before.id}): загрузка видео не вернула video_id; вариант не изменён`,
    };
  }

  let ready = false;
  for (let attempt = 1; attempt <= CATALOG_VIDEO_POLL_LIMIT; attempt += 1) {
    if (attempt > 1) {
      await mcp.waitForVideoPollInterval(CATALOG_VIDEO_POLL_INTERVAL_MS);
    }
    let video: unknown;
    try {
      video = await mcp.call("get_video", { video_id: videoId });
    } catch (error) {
      return {
        kind: "failed",
        message: `SKU ${before.sku} (${before.id}): video_id ${videoId} загружен, но проверка обработки не удалась — ${
          error instanceof Error ? error.message : String(error)
        }; вариант не изменён`,
      };
    }
    const status =
      video && typeof video === "object" && "status" in video
        ? String(video.status)
        : undefined;
    if (status === "READY") {
      ready = true;
      break;
    }
    if (status === "ERROR") {
      return {
        kind: "failed",
        message: `SKU ${before.sku} (${before.id}): обработка video_id ${videoId} завершилась ERROR; вариант не изменён`,
      };
    }
  }
  if (!ready) {
    return {
      kind: "failed",
      message: `SKU ${before.sku} (${before.id}): video_id ${videoId} не достиг READY за ${CATALOG_VIDEO_POLL_LIMIT} проверок; вариант не изменён`,
    };
  }

  const expected: CatalogVariant["media"] = [
    ...before.media,
    {
      type: "VIDEO",
      video_id: videoId,
      display_sequence: displaySequence,
    },
  ];
  const linked = await executeVerifiedVariantMutation({
    mcp,
    variant: before,
    fromDetail: true,
    write: () =>
      mcp.call("update_variant", {
        id: before.id,
        variant: { media: expected },
      }),
    verify: (after) => ({
      valid: sameMedia(after.media, expected),
      message: sameMedia(after.media, expected)
        ? `SKU ${after.sku} (${after.id}): video_id ${videoId} добавлен на позицию ${displaySequence}, полный media подтверждён`
        : `SKU ${after.sku} (${after.id}): повторное чтение не совпало с полным сохранённым массивом media`,
    }),
  });
  return {
    ...linked,
    message: `video_id ${videoId} достиг READY; ${linked.message}`,
  };
}

const VOLUME_IN_NAME = /^(.*\S)\s*,\s*(\d+(?:[.,]\d+)?\s*(?:мл|ml|л|l))\s*$/iu;

/**
 * Canonical quantity key for a volume value: «12 ml» and «12 мл» denote the
 * same quantity; anything that is not a pure volume yields undefined.
 */
function volumeKey(value: string): string | undefined {
  const parsed = /^(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l)$/iu.exec(value.trim());
  if (!parsed) return undefined;
  const unit = parsed[2].toLowerCase();
  const canonicalUnit = unit === "ml" ? "мл" : unit === "l" ? "л" : unit;
  return `${Number(parsed[1].replace(",", "."))} ${canonicalUnit}`;
}

function volumeMovePlan(
  before: CatalogVariant,
  characteristicId: string,
): { name: string; characteristics: CatalogVariant["characteristics"] } | undefined {
  const parsed = VOLUME_IN_NAME.exec(before.name);
  if (!parsed) return undefined;
  const volume = parsed[2].replace(/\s+/gu, " ");
  const key = volumeKey(volume);
  return {
    name: parsed[1],
    characteristics: [
      ...(before.characteristics ?? []).filter(
        (item) =>
          item.characteristic_id !== characteristicId &&
          volumeKey(item.value) !== key,
      ),
      { characteristic_id: characteristicId, value: volume, values: [volume] },
    ],
  };
}

async function executeVolumeMoveToCharacteristic(
  mcp: FakeCatalogDoctorFixMcp,
  reference: string,
  characteristicId: string,
): Promise<MutationOutcome> {
  const resolved = await resolveOneVariant(mcp, reference);
  if ("outcome" in resolved) return resolved.outcome;
  // The detail read is the complete current characteristics state — an empty
  // list is genuinely empty, so the rebuilt list is provably full (issue #91).
  return executeVerifiedVariantMutation({
    mcp,
    variant: resolved.variant,
    fromDetail: resolved.fromDetail,
    validate: (before) =>
      volumeMovePlan(before, characteristicId)
        ? undefined
        : "в конце названия нет объёма; запись не выполняется",
    write: (before) =>
      mcp.call("update_variant", {
        id: before.id,
        variant: volumeMovePlan(before, characteristicId)!,
      }),
    verify: (after, before) => {
      const expected = volumeMovePlan(before, characteristicId)!;
      const valid =
        after.name === expected.name &&
        JSON.stringify(after.characteristics ?? []) ===
          JSON.stringify(expected.characteristics);
      return {
        valid,
        message: valid
          ? `SKU ${after.sku} (${after.id}): объём «${expected.characteristics!.at(-1)!.value}» перенесён из названия в характеристику ${characteristicId}, несвязанные характеристики сохранены`
          : `SKU ${after.sku} (${after.id}): повторное чтение не совпало с ожидаемыми name и полным массивом characteristics`,
      };
    },
  });
}

function mediaWithoutVideo(
  media: CatalogVariant["media"],
): CatalogVariant["media"] {
  return media.filter((item) => item.type !== "VIDEO");
}

async function executeVideoRemoval(
  mcp: FakeCatalogDoctorFixMcp,
  reference: string,
): Promise<MutationOutcome> {
  const resolved = await resolveOneVariant(mcp, reference);
  if ("outcome" in resolved) return resolved.outcome;
  // The detail read confirms the full current media list; a single remaining
  // image is a valid complete list, not evidence of truncation (issue #90).
  return executeVerifiedVariantMutation({
    mcp,
    variant: resolved.variant,
    fromDetail: resolved.fromDetail,
    validate: (before) =>
      before.media.some((item) => item.type === "VIDEO")
        ? undefined
        : "в media нет видео; вариант не изменён",
    write: (before) =>
      mcp.call("update_variant", {
        id: before.id,
        variant: { media: mediaWithoutVideo(before.media) },
      }),
    verify: (after, before) => {
      const expected = mediaWithoutVideo(before.media);
      return {
        valid: sameMedia(after.media, expected),
        message: sameMedia(after.media, expected)
          ? `SKU ${after.sku} (${after.id}): видео удалено, остальные media подтверждены полным сохранённым списком`
          : `SKU ${after.sku} (${after.id}): повторное чтение не совпало с полным сохранённым массивом media`,
      };
    },
  });
}

async function executePermanentVariantDeletion(
  mcp: FakeCatalogDoctorFixMcp,
  reference: string,
): Promise<MutationOutcome> {
  const resolved = await resolveOneVariant(mcp, reference);
  if ("outcome" in resolved) return resolved.outcome;
  const listed = resolved.variant;

  let before: CatalogVariant;
  if (resolved.fromDetail) {
    before = listed;
  } else {
    try {
      before = (await mcp.call("get_variant", {
        id: listed.id,
      })) as CatalogVariant;
    } catch (error) {
      return {
        kind: "failed",
        message: `SKU ${listed.sku} (${listed.id}): чтение не удалось — ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
  if (before.status !== "ARCHIVED") {
    return {
      kind: "failed",
      message: `SKU ${before.sku} (${before.id}): статус ${before.status}; безвозвратное удаление разрешено API только для ARCHIVED`,
    };
  }

  let writeError: unknown;
  try {
    await mcp.call("kit_request", {
      operation_id: "DeleteVariant",
      path_params: { id: before.id },
    });
  } catch (error) {
    writeError = error;
  }

  let deleted = false;
  try {
    await mcp.call("get_variant", { id: before.id });
  } catch (error) {
    deleted = isNotFound(error);
    if (!deleted) {
      return {
        kind: "ambiguous",
        message: `SKU ${before.sku} (${before.id}): повторное чтение не удалось; результат неизвестен, нужна проверка`,
      };
    }
  }

  if (writeError) {
    const message =
      writeError instanceof Error ? writeError.message : String(writeError);
    return {
      kind: mutationResultIsAmbiguous(writeError) ? "ambiguous" : "failed",
      message: mutationResultIsAmbiguous(writeError)
        ? `SKU ${before.sku} (${before.id}): DeleteVariant вызван один раз и завершился ошибкой «${message}»; результат неизвестен, нужна проверка`
        : `SKU ${before.sku} (${before.id}): ${message}`,
    };
  }
  return {
    kind: deleted ? "completed" : "ambiguous",
    message: deleted
      ? `SKU ${before.sku} (${before.id}): безвозвратно удалён, повторное чтение вернуло not found`
      : `SKU ${before.sku} (${before.id}): после DeleteVariant объект всё ещё читается; результат неизвестен, нужна проверка`,
  };
}

interface PriceBatchPlan {
  entries: Array<{ reference: string; price: string }>;
  outcomes: MutationOutcome[];
}

function parsePriceBatch(request: string): PriceBatchPlan | undefined {
  const match = /поставь\s+цены\s*:\s*(.+)$/iu.exec(request);
  if (!match) return undefined;
  const parsedEntries: Array<{ reference: string; price: string }> = [];
  const outcomes: MutationOutcome[] = [];
  for (const [index, item] of match[1].split(",").entries()) {
    const parsed = /^\s*([^\s=,]+)\s*=\s*([\d\s\u00a0]+(?:[.,]\d+)?)\s*$/u.exec(
      item,
    );
    if (!parsed) {
      const target = /^\s*([^\s=,]+)\s*=/u.exec(item)?.[1];
      outcomes.push({
        kind: "ambiguous",
        message: target
          ? `SKU ${target}: в позиции пакета ${index + 1} не задана точная числовая цена`
          : `Позиция пакета ${index + 1} «${item.trim() || "пусто"}»: не распознаны точные SKU и цена`,
      });
      continue;
    }
    const price = normalizeDecimal(parsed[2]);
    if (price) parsedEntries.push({ reference: parsed[1], price });
  }

  const grouped = new Map<
    string,
    { reference: string; prices: Set<string> }
  >();
  for (const entry of parsedEntries) {
    const key = entry.reference.toLowerCase();
    const group = grouped.get(key) ?? {
      reference: entry.reference,
      prices: new Set<string>(),
    };
    group.prices.add(entry.price);
    grouped.set(key, group);
  }

  const entries: PriceBatchPlan["entries"] = [];
  for (const group of grouped.values()) {
    if (group.prices.size > 1) {
      outcomes.push({
        kind: "ambiguous",
        message: `SKU ${group.reference}: в одном пакете заданы конфликтующие цены ${[...group.prices].join(" и ")}; укажите одно значение`,
      });
      continue;
    }
    entries.push({
      reference: group.reference,
      price: [...group.prices][0]!,
    });
  }
  return { entries, outcomes };
}

export async function runCatalogDoctorFixScenario({
  request,
  mcp,
}: {
  request: string;
  mcp: FakeCatalogDoctorFixMcp;
}): Promise<{ report: string }> {
  const priceBatch = parsePriceBatch(request);
  if (priceBatch) {
    const outcomes: MutationOutcome[] = [...priceBatch.outcomes];
    for (
      let start = 0;
      start < priceBatch.entries.length;
      start += CATALOG_FIX_BATCH_LIMIT
    ) {
      const chunk = priceBatch.entries.slice(
        start,
        start + CATALOG_FIX_BATCH_LIMIT,
      );
      for (const item of chunk) {
        outcomes.push(
          await executePriceChange(mcp, item.reference, item.price),
        );
      }
    }
    return finish(mcp, outcomes, true);
  }

  const exactPrice =
    /(?:поставь|установи|измени)\s+цену\s+([\d\s\u00a0]+(?:[.,]\d+)?)\s+для\s+(?:SKU\s+)?([^\s,]+)/iu.exec(
      request,
    );
  if (exactPrice) {
    const price = normalizeDecimal(exactPrice[1]);
    if (!price) {
      return finish(mcp, [
        {
          kind: "ambiguous",
          message: "Цена: укажите точное числовое значение и SKU",
        },
      ]);
    }
    return finish(mcp, [
      await executePriceChange(mcp, exactPrice[2], price),
    ]);
  }

  const exactStock =
    /поставь\s+остаток\s+(\d+)\s+на\s+складе\s+([^\s,]+)\s+для\s+(?:SKU\s+)?([^\s,]+)/iu.exec(
      request,
    );
  if (exactStock) {
    const quantity = Number(exactStock[1]);
    const warehouseId = exactStock[2];
    const reference = exactStock[3];
    const resolved = await resolveOneVariant(mcp, reference);
    if ("outcome" in resolved) return finish(mcp, [resolved.outcome]);
    const outcome = await executeVerifiedVariantMutation({
      mcp,
      variant: resolved.variant,
      fromDetail: resolved.fromDetail,
      write: async (before) => {
        const target = before.stocks.find(
          (stock) => stock.warehouse_id === warehouseId,
        );
        if (!target) {
          throw new Error(
            `склад ${warehouseId} отсутствует в остатках SKU; источник новой складской связи не задан`,
          );
        }
        const stocks = before.stocks.map((stock) =>
          stock.warehouse_id === warehouseId
            ? { ...stock, quantity }
            : stock,
        );
        return mcp.call("update_variant", {
          id: before.id,
          variant: { stocks },
        });
      },
      verify: (after, before) => {
        const expected = before.stocks.map((stock) =>
          stock.warehouse_id === warehouseId
            ? { ...stock, quantity }
            : stock,
        );
        return {
          valid: sameStocks(after.stocks, expected),
          message: sameStocks(after.stocks, expected)
            ? `SKU ${after.sku} (${after.id}): остаток склада ${warehouseId} установлен ${quantity}, соседние склады сохранены`
            : `SKU ${after.sku} (${after.id}): повторное чтение не совпало с полным сохранённым массивом stocks`,
        };
      },
    });
    return finish(mcp, [outcome]);
  }

  const exactImage =
    /добавь\s+изображение\s+([^\s,]+)\s+на\s+позици(?:ю|и)\s+(\d+)\s+для\s+(?:SKU\s+)?([^\s,]+)/iu.exec(
      request,
    );
  if (exactImage) {
    const imageId = exactImage[1];
    const displaySequence = Number(exactImage[2]);
    const reference = exactImage[3];
    const resolved = await resolveOneVariant(mcp, reference);
    if ("outcome" in resolved) return finish(mcp, [resolved.outcome]);
    const outcome = await executeVerifiedVariantMutation({
      mcp,
      variant: resolved.variant,
      fromDetail: resolved.fromDetail,
      write: async (before) => {
        if (
          before.media.some(
            (media) => media.display_sequence === displaySequence,
          )
        ) {
          throw new Error(
            `позиция ${displaySequence} уже занята; нужен точный порядок перемещения существующего media`,
          );
        }
        const media: CatalogVariant["media"] = [
          ...before.media,
          {
            type: "IMAGE",
            image_id: imageId,
            display_sequence: displaySequence,
          },
        ];
        return mcp.call("update_variant", {
          id: before.id,
          variant: { media },
        });
      },
      verify: (after, before) => {
        const expected: CatalogVariant["media"] = [
          ...before.media,
          {
            type: "IMAGE",
            image_id: imageId,
            display_sequence: displaySequence,
          },
        ];
        return {
          valid: sameMedia(after.media, expected),
          message: sameMedia(after.media, expected)
            ? `SKU ${after.sku} (${after.id}): image_id ${imageId} добавлен на позицию ${displaySequence}, соседние media сохранены`
            : `SKU ${after.sku} (${after.id}): повторное чтение не совпало с полным сохранённым массивом media`,
        };
      },
    });
    return finish(mcp, [outcome]);
  }

  const exactVideoFromUrl =
    /добавь\s+видео(?:\s+по\s+ссылке)?\s+(https?:\/\/[^\s,]+)\s+на\s+позици(?:ю|и)\s+(\d+)\s+для\s+(?:SKU\s+)?([^\s,]+)/iu.exec(
      request,
    );
  if (exactVideoFromUrl) {
    return finish(mcp, [
      await executeVideoFromUrlAddition(
        mcp,
        exactVideoFromUrl[3],
        exactVideoFromUrl[1],
        Number(exactVideoFromUrl[2]),
      ),
    ]);
  }

  const volumeMove =
    /(?:перенеси|убери)\s+объ[её]м\s+из\s+названия\s+в\s+характеристику\s+([^\s,]+)\s+для\s+(?:SKU\s+)?([^\s,]+)/iu.exec(
      request,
    );
  if (volumeMove) {
    return finish(mcp, [
      await executeVolumeMoveToCharacteristic(
        mcp,
        volumeMove[2],
        volumeMove[1],
      ),
    ]);
  }

  const exactVideoRemoval =
    /(?:удали|убери)\s+видео\s+(?:у|для|из)\s+(?:SKU\s+)?([^\s,]+)/iu.exec(
      request,
    );
  if (exactVideoRemoval) {
    return finish(mcp, [
      await executeVideoRemoval(mcp, exactVideoRemoval[1]),
    ]);
  }

  const permanentDelete =
    /безвозвратно\s+удал(?:и|ить)\s+(?:SKU\s+)?([^\s,]+)/iu.exec(request);
  if (permanentDelete) {
    return finish(mcp, [
      await executePermanentVariantDeletion(mcp, permanentDelete[1]),
    ]);
  }

  if (/исправь\s+остатки/iu.test(request)) {
    return finish(mcp, [
      {
        kind: "ambiguous",
        message:
          "Остатки: укажите источник правильных количеств, точные SKU и warehouse_id; до этого write-инструменты не вызываются",
      },
    ]);
  }

  if (/исправь\s+вс[её]/iu.test(request)) {
    return finish(mcp, [
      {
        kind: "ambiguous",
        message:
          "Поля без надёжного источника сгруппированы: цены — нужен прайс/ERP, остатки — WMS/ERP, категории/характеристики/media — точные ID и значения владельца",
      },
    ]);
  }

  if (/удал/iu.test(request)) {
    return finish(mcp, [
      {
        kind: "ambiguous",
        message:
          "Удаление: уточните точный объект и действие — архивировать, восстановить или безвозвратно удалить; операции не подменяются",
      },
    ]);
  }

  return finish(mcp, [
    {
      kind: "ambiguous",
      message:
        "Исправление не однозначно: укажите точный объект, операцию и правильное значение либо надёжный источник",
    },
  ]);
}
