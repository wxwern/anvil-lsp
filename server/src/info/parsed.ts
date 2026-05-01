/**
 * Typesafe, schema-validated access to the Anvil info JSON lookup tables.
 *
 * These JSON files are user-facing content tables rather than arbitrary data:
 * they drive completion labels/details, hover explanations, timing annotation
 * snippets, and example blocks shown in documentation popups.
 *
 * Two singletons are exported:
 *   - `completionInfo`  - derived from completion-info.json
 *   - `astNodeInfo`     - derived from ast-node-info.json
 *
 * This file is the source of truth for the accepted structure of
 * `server/src/info/*.json`. If comments inside the JSON drift, or if higher
 * level docs become stale, trust the Zod schemas and wrapper behaviour here.
 *
 * Both JSON payloads are validated with Zod at module load time; an error is
 * thrown immediately if the files are missing or do not match the expected
 * schema.
 */

import { z } from 'zod';
import completionInfoJson from './completion-info.json';
import astNodeInfoJson from './ast-node-info.json';
import { AnvilAstNode } from '../core/ast/AnvilAst';
import { AnvilLiteralSchema, AnvilTypeSchema } from '../core/ast/schema';

//
// HELPERS
//

function validate<T>(schema: z.ZodType<T>, data: unknown, filePath: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Schema validation failed for ${filePath}:\n${issues}`);
  }
  return result.data;
}

//
// SCOPE VALUE
//
// A scope entry is one of:
//   - null / absent     only valid at the top-level global scope
//   - a two-char string valid when surrounded by those delimiter characters,
//                         e.g. "()" or "<>"
//   - any other string  valid when nested inside an AST node of that kind
//

export type ScopeValue =
  | { kind: 'global' }
  | { kind: 'delimited'; open: string; close: string }
  | { kind: 'astNode'; nodeKind: string };

function parseScopeValue(raw: string | null): ScopeValue {
  if (raw === null) return { kind: 'global' };
  if (raw.length === 2)
    return { kind: 'delimited', open: raw[0], close: raw[1] };
  return { kind: 'astNode', nodeKind: raw };
}

//
// KEYWORD VARIANT EXPANSION
//
// A raw keyword entry may have any of its fields expressed as either a scalar
// or an array.  Whenever at least one field is an array of length N, every
// scalar field is broadcast to length N and every array field must also have
// length N (otherwise an error is thrown).  The result is N KeywordVariant
// objects, each with purely scalar fields.
//

export interface KeywordInfoEntryVariant {
  /** Completion category (e.g. "modifier", "declaration", "control"). */
  category: string;
  /** Display hint text. */
  hint: string;
  /** LSP completion kind for this variant (e.g. "Keyword"). */
  lspKind: string;
  /** Associated AST node kind, or null if not applicable. */
  astKind: string | null;
  /** Markdown documentation string, or null if absent. */
  description: string | null;
  /**
   * Insert text used for the completion item. When non-null and different from
   * the label, this is usually emitted as an LSP snippet.
   */
  snippet: string | null;
  /**
   * Where this variant is intended to be valid.
   * Both an absent scope field and an explicit JSON null mean top-level
   * global scope (`{ kind: 'global' }`).
   *
   * TODO: the parser normalises and exposes this field, and tests cover the
   * normalisation rules, but the current completion generator does not yet
   * actively filter built-in keyword completions by scope.
   */
  scope: ScopeValue;
}

//
// EXPORTED TYPES
//

export interface CompletionKindInfoEntry {
  /** Short detail string shown next to AST-backed completion items. */
  hint: string;
  /** String form of an LSP CompletionItemKind enum member. */
  lspKind: string;
}

export interface KeywordInfoEntry {
  /**
   * One or more variants produced by expanding parallel arrays in the source.
   * A keyword with no array fields always has exactly one variant.
   */
  variants: KeywordInfoEntryVariant[];
}

export interface TimingInfoEntry {
  /** Short detail string shown in the completion list. */
  hint: string;
  /** Snippet or plain insert text emitted by the timing completion heuristic. */
  insertText: string;
  /** String form of an LSP CompletionItemKind enum member. */
  lspKind: string;
  /**
   * Associated AST node key (`kind` or `kind/type`), used only for optional
   * description back-fill from ast-node-info.json.
   */
  astKind: string | null;
  /** Markdown documentation shown in completion docs, after `%s` substitution. */
  description: string | null;
}

export interface AstNodeInfoEntry {
  /** Short human-readable label, used as the node name in explanations. */
  name: string;
  /** Markdown explanation block used in hover/completion docs. */
  description: string;
  /** Anvil code examples for this node, or null when none are provided. */
  examples: string | null;
  /**
   * True for internal/compiler-only nodes that should not appear in the
   * user-facing "Anvil Info" explanation section.
   */
  internal: boolean;
}

//
// RAW ZOD SCHEMAS
// (for validation of the JSON on disk)
//

// --- completion-info.json ---
//
// Shape overview:
//   {
//     kind: { <kind-or-kind/type>: CompletionKindEntry | comment-string }
//     builtInKeywordCompletions: {
//       <keyword>: RawKeywordEntry | comment-string
//     }
//     timingCompletions?: {
//       _substitutionPatterns?: {...}   // TODO: currently validated but not consumed
//       lifetime: { <pattern>: RawTimingEntry }
//       sync: { <pattern>: RawTimingEntry }
//     }
//   }
//
// Runtime consumers:
//   - `kind` entries are used by `CompletionInfo.getKindMetadata()`, primarily
//     by `AnvilCompletionGenerator` to derive completion detail text and LSP
//     item kinds for AST-backed symbols.
//   - `builtInKeywordCompletions` entries are expanded into one or more keyword
//     completion variants by `expandKeywordVariants()` and then used by
//     `AnvilCompletionGenerator.getAnvilBuiltinCompletions()`.
//   - `timingCompletions` entries are used only by the timing-annotation
//     completion heuristic in
//     `AnvilCompletionGenerator.checkTimingAnnotHeuristics()`.
//
// Documentation back-fill:
//   Any completion entry carrying a non-null `astKind` may omit its own
//   `description`; in that case the description is back-filled from the
//   matching `ast-node-info.json` entry.
//
// Comment entries:
//   Plain string values are allowed so the JSON can carry inline comments like
//   `_comment`. These are intentionally ignored by the wrappers below.

const RawCompletionKindEntrySchema = z.object({
  hint: z.string(),
  lspKind: z.string(),
});

// --- ast-node-info.json ---
//
// Shape overview:
//   {
//     kind: { <kind-or-kind/type>: AstNodeEntry | comment-string }
//   }
//
// Runtime consumers:
//   - `AstNodeInfo.getFor()` is used by `AnvilDescriptionGenerator` to render
//     the "Anvil Info" explanation block on hover and completion docs.
//   - `CompletionInfo` also consults this table to back-fill missing
//     descriptions for completion and timing-completion entries that specify an
//     `astKind` but no explicit `description`.
//
// Key format:
//   - `kind` for broad node families, e.g. `proc_def`
//   - `kind/type` when the AST `type` discriminator changes the user-facing
//     meaning, e.g. `expr/binop` or `data_type/record`
//
// Comment entries:
//   Plain string values are likewise ignored so `_comment` keys can be kept in
//   the JSON file without affecting runtime behaviour.

const Nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable();
const ScalarOrArray = <T extends z.ZodTypeAny>(t: T) =>
  z.union([t, z.array(t)]);
const NullableScalarOrArray = <T extends z.ZodTypeAny>(t: T) =>
  z.union([Nullable(t), z.array(Nullable(t))]);

// Raw keyword entries support scalar-or-array fields because one source token
// may map to multiple semantic contexts. For example, a single keyword may
// need one variant for a top-level declaration and another for a nested
// parameter context. The wrapper layer expands these parallel arrays into a
// flat list of concrete variants.
const RawKeywordEntrySchema = z.object({
  category: ScalarOrArray(z.string()),
  hint: ScalarOrArray(z.string()),
  lspKind: ScalarOrArray(z.string()),
  astKind: NullableScalarOrArray(z.string()).optional(),
  description: NullableScalarOrArray(z.string()).optional(),
  snippet: NullableScalarOrArray(z.string()).optional(),
  scope: NullableScalarOrArray(z.string()).optional(),
});

// Timing entries are narrower than built-in keyword entries. Each key is a
// syntactic pattern shown in the timing-annotation completion UI, and each
// value provides the label/detail/snippet/description metadata for that one
// pattern. The `%s` placeholder is expanded manually by
// `AnvilCompletionGenerator` against sibling message names.
const RawTimingEntrySchema = z.object({
  hint: z.string(),
  insertText: z.string(),
  lspKind: z.string(),
  astKind: z.string().optional(),
  description: z.string().optional(),
});

const RawCompletionInfoSchema = z.object({
  kind: z.record(
    z.string(),
    z.union([z.string(), RawCompletionKindEntrySchema]),
  ),
  builtInKeywordCompletions: z.record(
    z.string(),
    z.union([z.string(), RawKeywordEntrySchema]),
  ),
  timingCompletions: z
    .object({
      _substitutionPatterns: z.record(z.string(), z.unknown()).optional(),
      lifetime: z.record(z.string(), RawTimingEntrySchema),
      sync: z.record(z.string(), RawTimingEntrySchema),
    })
    .optional(),
});

const RawAstNodeEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  examples: z.string().optional(),
  internal: z.boolean().optional(),
});

const RawAstNodeInfoSchema = z.object({
  kind: z.record(z.string(), z.union([z.string(), RawAstNodeEntrySchema])),
});

//
// VARIANT EXPANSION
//

type RawKeyword = z.infer<typeof RawKeywordEntrySchema>;
type NullableStringOrArray = string | null | (string | null)[];

/**
 * Normalise a raw variadic field to an array of (string | null).
 * A scalar is returned as a one-element array.
 * Returns undefined (not null) when the field was absent, so callers can
 * distinguish "field missing" from "field present with null element".
 */
function toNullableArray(
  value: NullableStringOrArray | undefined,
): (string | null)[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  return [value];
}

/**
 * Expand a raw keyword entry into an ordered list of KeywordVariant objects.
 *
 * Rules:
 *  1. N is determined by the maximum array length > 1 found across all fields.
 *     If no field has length > 1, N = 1.
 *  2. Every field that is an array of length > 1 must have the same length N.
 *  3. A scalar (or absent) field broadcasts to all N variants.
 *  4. Both an absent scope field and an explicit JSON null scope mean
 *     `{ kind: 'global' }` - there is no distinction between the two.
 *
 * Throws if two fields with length > 1 disagree on length.
 *
 * This expansion is important because runtime completion generation iterates
 * concrete variants only; it never looks at the raw scalar-or-array source
 * shape again.
 */
function expandKeywordVariants(
  keyword: string,
  raw: RawKeyword,
): KeywordInfoEntryVariant[] {
  // Gather raw arrays; undefined means the field was absent.
  const rawCategories = toNullableArray(raw.category as NullableStringOrArray);
  const rawHints = toNullableArray(raw.hint as NullableStringOrArray);
  const rawLspKinds = toNullableArray(raw.lspKind as NullableStringOrArray);
  const rawAstKinds = toNullableArray(
    raw.astKind as NullableStringOrArray | undefined,
  );
  const rawDescriptions = toNullableArray(
    raw.description as NullableStringOrArray | undefined,
  );
  const rawSnippets = toNullableArray(
    raw.snippet as NullableStringOrArray | undefined,
  );
  const rawScopes = toNullableArray(
    raw.scope as NullableStringOrArray | undefined,
  );

  // Find multi-element arrays to determine N.
  const multiLengths: { field: string; len: number }[] = [];
  for (const [field, arr] of [
    ['category', rawCategories],
    ['hint', rawHints],
    ['lspKind', rawLspKinds],
    ['astKind', rawAstKinds],
    ['description', rawDescriptions],
    ['snippet', rawSnippets],
    ['scope', rawScopes],
  ] as [string, (string | null)[] | undefined][]) {
    if (arr !== undefined && arr.length > 1)
      multiLengths.push({ field, len: arr.length });
  }

  const distinctMulti = [...new Set(multiLengths.map((x) => x.len))];
  if (distinctMulti.length > 1) {
    const detail = multiLengths.map((x) => `${x.field}[${x.len}]`).join(', ');
    throw new Error(
      `completion-info.json: keyword "${keyword}" has mismatched array lengths: ${detail}`,
    );
  }
  const N = distinctMulti[0] ?? 1;

  /**
   * Broadcast a nullable field array to length N.
   *   - absent (undefined)        N repetitions of null
   *   - scalar (length 1)         N repetitions of that value
   *   - array of length N         used as-is
   */
  function broadcastNullable(
    arr: (string | null)[] | undefined,
  ): (string | null)[] {
    if (arr === undefined) return Array(N).fill(null);
    if (arr.length === 1) return Array(N).fill(arr[0]);
    return arr;
  }

  const categories = broadcastNullable(rawCategories);
  const hints = broadcastNullable(rawHints);
  const lspKinds = broadcastNullable(rawLspKinds);
  const astKinds = broadcastNullable(rawAstKinds);
  const descriptions = broadcastNullable(rawDescriptions);
  const snippets = broadcastNullable(rawSnippets);
  const scopes = broadcastNullable(rawScopes);

  return Array.from({ length: N }, (_, i) => ({
    category: categories[i] as string, // required, never null
    hint: hints[i] as string, // required, never null
    lspKind: lspKinds[i] as string, // required, never null
    astKind: astKinds[i],
    snippet: snippets[i],
    description: descriptions[i],
    scope: parseScopeValue(scopes[i]),
  }));
}

//
// WRAPPERS
//

export class CompletionInfo {
  private readonly kindMap: ReadonlyMap<string, CompletionKindInfoEntry>;
  private readonly keywordMap: ReadonlyMap<string, KeywordInfoEntry>;
  private readonly lifetimeTimingMap: ReadonlyMap<string, TimingInfoEntry>;
  private readonly syncTimingMap: ReadonlyMap<string, TimingInfoEntry>;

  /**
   * @param raw     Validated completion-info JSON.
   * @param nodeInfo Optional AstNodeInfo instance used to back-fill missing
   *                 descriptions from AST node documentation.  When an entry
   *                 has a non-null `astKind` but a null `description`, the
   *                 description is resolved from `nodeInfo` automatically.
   */
  constructor(
    raw: z.infer<typeof RawCompletionInfoSchema>,
    nodeInfo?: AstNodeInfo,
  ) {
    /**
     * Look up the description for an astKind string (e.g. "proc_def" or
     * "expr/if_expr") from the provided AstNodeInfo, if any.
     *
     * This is the main link between completion-info.json and
     * ast-node-info.json: completion metadata can stay terse and rely on the
     * AST-node table for the canonical prose description.
     */
    function resolveDescription(
      astKind: string | null,
      explicit: string | null,
    ): string | null {
      if (explicit !== null) return explicit;
      if (astKind === null || nodeInfo === undefined) return null;
      const slashIdx = astKind.indexOf('/');
      const entry =
        slashIdx === -1
          ? nodeInfo.getFrom(astKind)
          : nodeInfo.getFrom(
              astKind.slice(0, slashIdx),
              astKind.slice(slashIdx + 1),
            );
      return entry?.description ?? null;
    }

    // kind map - strip plain-string comment entries
    const kindEntries: [string, CompletionKindInfoEntry][] = [];
    for (const [k, v] of Object.entries(raw.kind)) {
      if (typeof v === 'string') continue;
      kindEntries.push([k, { hint: v.hint, lspKind: v.lspKind }]);
    }
    this.kindMap = new Map(kindEntries);

    // keyword map - strip comment entries, expand variants, and back-fill
    // missing descriptions from ast-node-info.json when astKind is present.
    const keywordEntries: [string, KeywordInfoEntry][] = [];
    for (const [k, v] of Object.entries(raw.builtInKeywordCompletions)) {
      if (typeof v === 'string') continue;
      const variants = expandKeywordVariants(k, v).map((variant) => ({
        ...variant,
        description: resolveDescription(variant.astKind, variant.description),
      }));
      keywordEntries.push([k, { variants }]);
    }
    this.keywordMap = new Map(keywordEntries);

    // timing maps
    //
    // These are intentionally kept separate because the completion heuristic
    // treats the first lifetime annotation and later sync annotations as two
    // different syntactic contexts.
    const lifetimeEntries: [string, TimingInfoEntry][] = [];
    const syncEntries: [string, TimingInfoEntry][] = [];
    if (raw.timingCompletions) {
      for (const [k, v] of Object.entries(raw.timingCompletions.lifetime)) {
        const astKind = v.astKind ?? null;
        lifetimeEntries.push([
          k,
          {
            hint: v.hint,
            insertText: v.insertText,
            lspKind: v.lspKind,
            astKind,
            description: resolveDescription(astKind, v.description ?? null),
          },
        ]);
      }
      for (const [k, v] of Object.entries(raw.timingCompletions.sync)) {
        const astKind = v.astKind ?? null;
        syncEntries.push([
          k,
          {
            hint: v.hint,
            insertText: v.insertText,
            lspKind: v.lspKind,
            astKind,
            description: resolveDescription(astKind, v.description ?? null),
          },
        ]);
      }
    }
    this.lifetimeTimingMap = new Map(lifetimeEntries);
    this.syncTimingMap = new Map(syncEntries);
  }

  /**
   * LSP completion metadata for an AST node kind. Returns `null` if absent.
   *
   * Resolution order matters:
   *   1. for plain `(kind, type)` lookups, prefer `kind/type`, then `kind`
   *   2. for `AnvilAstNode` lookups, optionally override with the underlying
   *      `data_type/record` or `data_type/variant` kind for typedef nodes
   *
   * That typedef override is what lets completions for named struct/enum types
   * surface as `Struct`/`Enum` instead of generic `Type` where appropriate.
   */
  getKindMetadata(
    kind: string | AnvilAstNode | null,
    type?: string | null,
  ): CompletionKindInfoEntry | null {
    if (kind instanceof AnvilAstNode) {
      const node = kind;
      if (!node.kind) return null;

      let result = this.getKindMetadata(kind.kind, kind.type);

      const typedef = node.resolveAs(AnvilTypeSchema);
      if (typedef) {
        const dataType = typedef.data_type;
        switch (dataType.type) {
          case 'record':
          case 'variant': {
            result =
              this.getKindMetadata(dataType.kind, dataType.type) ?? result;
          }
        }
      }

      return result;
    }

    if (type) {
      const combined = `${kind}/${type}`;
      const entry = this.kindMap.get(combined);
      if (entry) return entry;
    }
    if (kind) {
      return this.kindMap.get(kind) ?? null;
    }
    return null;
  }

  /**
   * Keyword completion data for a built-in keyword. Returns `null` if absent.
   * Use `.variants` to iterate all expanded variants.
   *
   * Each variant already has broadcast scalar fields expanded, scope
   * normalised, and any missing description back-filled from ast-node-info.
   */
  getKeywordMetadata(keyword: string): KeywordInfoEntry | null {
    return this.keywordMap.get(keyword) ?? null;
  }

  /**
   * Timing completion entry for a lifetime pattern key (e.g. `"#N"`,
   * `"eternal"`, or a `%s` placeholder pattern).
   */
  getLifetimeTimingEntry(key: string): TimingInfoEntry | null {
    return this.lifetimeTimingMap.get(key) ?? null;
  }

  /**
   * Timing completion entry for a sync pattern key (e.g. `"dyn"`, `"#N"`, or
   * a `%s` placeholder pattern).
   */
  getSyncTimingEntry(key: string): TimingInfoEntry | null {
    return this.syncTimingMap.get(key) ?? null;
  }

  /** All AST node kind strings present in the kind table. */
  get knownKinds(): string[] {
    return Array.from(this.kindMap.keys());
  }

  /** All built-in keyword strings. */
  get knownKeywords(): string[] {
    return Array.from(this.keywordMap.keys());
  }

  /** All pattern keys in the lifetime timing section. */
  get knownLifetimeTimingKeys(): string[] {
    return Array.from(this.lifetimeTimingMap.keys());
  }

  /** All pattern keys in the sync timing section. */
  get knownSyncTimingKeys(): string[] {
    return Array.from(this.syncTimingMap.keys());
  }
}

export class AstNodeInfo {
  private readonly nodeMap: ReadonlyMap<string, AstNodeInfoEntry>;

  constructor(raw: z.infer<typeof RawAstNodeInfoSchema>) {
    const entries: [string, AstNodeInfoEntry][] = [];
    for (const [k, v] of Object.entries(raw.kind)) {
      if (typeof v === 'string') continue;
      entries.push([
        k,
        {
          name: v.name,
          description: v.description,
          examples: v.examples ?? null,
          internal: v.internal ?? false,
        },
      ]);
    }
    this.nodeMap = new Map(entries);
  }

  /**
   * Look up info for an AST node by kind, optionally with a type discriminator.
   *
   * The lookup key is `kind` alone when `type` is omitted, or `"${kind}/${type}"`
   * when provided - matching the pattern documented in ast-node-info.json.
   *
   * Returns `null` if not found.
   *
   * @example
   *   getFrom('proc_def')        // { name: 'process', ... }
   *   getFrom('expr', 'binop')   // { name: 'binary operator', ... }
   */
  getFrom(kind: string, type?: string | null): AstNodeInfoEntry | null {
    const key = type ? `${kind}/${type}` : kind;
    return this.nodeMap.get(key) ?? null;
  }
  /**
   * Look up info for an AST node by itself.
   *
   * This intelligently extracts the most useful lookup keys.
   *
   * Resolution order matters here too:
   *   1. prefer `kind/type` over `kind`
   *   2. if the node resolves as a typedef, prefer the underlying
   *      `data_type/record` or `data_type/variant` entry when available
   *   3. if the node is an `expr/literal`, prefer the literal subtype entry
   *      such as `literal/decimal`
   *
   * This behaviour is what keeps user-facing explanations specific even when
   * the raw AST node category is broad.
   *
   * Returns `null` if not found.
   */
  getFor(node: AnvilAstNode): AstNodeInfoEntry | null {
    if (!node.kind) return null;

    let result = this.getFrom(node.kind, node.type);

    const typedef = node.resolveAs(AnvilTypeSchema);

    if (typedef) {
      const dataType = typedef.data_type;
      switch (dataType.type) {
        case 'record':
        case 'variant': {
          result = this.getFrom(dataType.kind, dataType.type) ?? result;
        }
      }
    }

    const literal = node
      .satisfyingKind('expr')
      ?.satisfyingType('literal')
      ?.down('value')
      .resolveAs(AnvilLiteralSchema);

    if (literal) {
      result = this.getFrom(literal.kind, literal.type) ?? result;
    }

    return result;
  }

  /** All lookup keys stored in this table (`"kind"` or `"kind/type"` strings). */
  get knownKeys(): string[] {
    return Array.from(this.nodeMap.keys());
  }
}

//
// MODULE-LEVEL INITIALISATION
// (throws on invalid JSON)
//
// The module exports below are intentionally created only after full schema
// validation succeeds. A malformed JSON edit should fail fast at load time
// rather than surface later as partial or misleading editor behaviour.
//

const _rawCompletionInfo = validate(
  RawCompletionInfoSchema,
  completionInfoJson,
  'completion-info.json',
);

const _rawAstNodeInfo = validate(
  RawAstNodeInfoSchema,
  astNodeInfoJson,
  'ast-node-info.json',
);

/** Pre-validated, typesafe access to `ast-node-info.json`. */
export const astNodeInfo = new AstNodeInfo(_rawAstNodeInfo);

/**
 * Pre-validated, typesafe access to `completion-info.json`.
 * Missing descriptions are automatically back-filled from `astNodeInfo`
 * when the entry carries a non-null `astKind`.
 */
export const completionInfo = new CompletionInfo(
  _rawCompletionInfo,
  astNodeInfo,
);
