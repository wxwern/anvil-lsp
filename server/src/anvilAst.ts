import { z } from "zod";


const AnvilSpanSchema = z.object({
  start: z.object({ line: z.number(), col: z.number() }),
  end: z.object({ line: z.number(), col: z.number() }),
});
export type AnvilSpan = z.infer<typeof AnvilSpanSchema>;

const AnvilDefSpanSchema = AnvilSpanSchema.extend({
  cunit: z.string().nullable().optional(),
});
export type AnvilDefSpan = z.infer<typeof AnvilDefSpanSchema>;

const AnvilSpannableSchema = z.object({
  kind: z.string(),
  span: AnvilSpanSchema,
  def_span: z.array(AnvilDefSpanSchema).optional(),
  action_event: z
    .object({
      tid: z.number(),
      eid: z.number(),
      to_eid: z.number().nullable().optional(),
    })
    .optional(),
});
export type AnvilSpannable = z.infer<typeof AnvilSpannableSchema>;




const AnvilUnknownNodeSchema = z.record(z.string(), z.unknown());
export type AnvilUnknownNode = z.infer<typeof AnvilUnknownNodeSchema>;





const AnvilRegisterSchema = AnvilSpannableSchema.extend({
  kind: z.literal("reg_def"),
  name: z.string(),
}).and(AnvilUnknownNodeSchema);
export type AnvilRegister = z.infer<typeof AnvilRegisterSchema>;

const AnvilEndpointSchema = AnvilSpannableSchema.extend({
  kind: z.literal("endpoint_def"),
  channel_class: z.string(),
}).and(AnvilUnknownNodeSchema);
export type AnvilEndpoint = z.infer<typeof AnvilEndpointSchema>;

const AnvilChannelSchema = AnvilSpannableSchema.extend({
  kind: z.literal("channel_def"),
  channel_class: z.string(),
  endpoint_left: z.string(),
  endpoint_right: z.string(),
}).and(AnvilUnknownNodeSchema);
export type AnvilChannel = z.infer<typeof AnvilChannelSchema>;

const AnvilExprSchema = AnvilSpannableSchema.extend({
  kind: z.literal("expr"),
  type: z.string(),
}).and(AnvilUnknownNodeSchema);
export type AnvilExpr = z.infer<typeof AnvilExprSchema>;

const AnvilThreadSchema = z.object({
  expr: AnvilExprSchema,
  rst: AnvilUnknownNodeSchema.optional().nullable(),
});




const AnvilChannelClassSchema = z.object({
  kind: z.literal("channel_class_def"),
})
  .and(AnvilSpannableSchema)
  .and(AnvilUnknownNodeSchema);
export type AnvilChannelClass = z.infer<typeof AnvilChannelClassSchema>;

const AnvilTypeSchema = z.object({
  kind: z.literal("type_def"),
})
  .and(AnvilSpannableSchema)
  .and(AnvilUnknownNodeSchema);
export type AnvilType = z.infer<typeof AnvilTypeSchema>;

const AnvilMacroSchema = z.object({
  kind: z.literal("macro_def"),
})
  .and(AnvilSpannableSchema)
  .and(AnvilUnknownNodeSchema);
export type AnvilMacro = z.infer<typeof AnvilMacroSchema>;

const AnvilFuncSchema = z.object({
  kind: z.literal("func_def"),
})
  .and(AnvilSpannableSchema)
  .and(AnvilUnknownNodeSchema);
export type AnvilFunc = z.infer<typeof AnvilFuncSchema>;

const AnvilProcSchema = z.object({
  kind: z.literal("proc_def"),
  name: z.string(),
  args: z.array(AnvilEndpointSchema),
  body: (
    z.object({
      type: z.literal("native"),
      channels: z.array(AnvilChannelSchema),
      regs: z.array(AnvilRegisterSchema),
      threads: z.array(AnvilThreadSchema),
    })
      .or(z.object({
        type: z.literal("extern")
      }))
  ).and(AnvilUnknownNodeSchema),
})
  .and(AnvilSpannableSchema)
  .and(AnvilUnknownNodeSchema);
export type AnvilProc = z.infer<typeof AnvilProcSchema>;




const AnvilEventGraphSchema = z.object({
  proc_name: z.string(),
  threads: z.array(
    z.object({
      tid: z.number(),
      events: z.array(
        z.object({
          eid: z.number(),
          outs: z.array(
            z.object({
              tid: z.number(),
              eid: z.number(),
            })
          ).optional(),
        })
      ),
      span: AnvilSpanSchema,
    })
  ),
});
export type AnvilEventGraph = z.infer<typeof AnvilEventGraphSchema>;

export const AnvilCompUnitSchema = z.object({
  file_name: z.string(),
  channel_classes: z.array(AnvilChannelClassSchema),
  type_defs: z.array(AnvilTypeSchema),
  macro_defs: z.array(AnvilMacroSchema),
  func_defs: z.array(AnvilFuncSchema),
  procs: z.array(AnvilProcSchema),
  imports: z.array(
    z.object({
      file_name: z.string(),
      is_extern: z.boolean(),
      span: AnvilSpanSchema,
    })
  ),
  event_graphs: z.array(AnvilEventGraphSchema).optional().nullable(),
});
export type AnvilCompUnit = z.infer<typeof AnvilCompUnitSchema>;





// ============================================================
// Core Types
// ============================================================

export type AnvilAstNodePath = (string | number)[];

export interface AnvilAbsoluteAstNodePath {
  filename: string;
  path: AnvilAstNodePath & { 0?: keyof AnvilCompUnit };
}

export class AnvilLocation {
  public readonly filename: string;
  public readonly span: Readonly<AnvilSpan>;

  constructor(filename: string, span: AnvilSpan) {
    this.filename = filename;
    this.span = span;
  }

  id(): string {
    const cs = this.span;
    return `${this.filename}:${cs.start.line}:${cs.start.col}:${cs.end.line}:${cs.end.col}`;
  }
}

export type AnvilLocationFilter = (loc: AnvilLocation) => boolean;

export class AnvilAstNode {
  private readonly _root: AnvilCompUnit;
  private readonly _path: AnvilAstNodePath;

  private _rootCache: AnvilAstNode | null = null;
  private _upCache: AnvilAstNode | null = null;
  private _downCache: { [key: string]: AnvilAstNode } = {};
  private _resolveCache: unknown | null | undefined = null;

  constructor(root: AnvilCompUnit, path: AnvilAstNodePath = []) {
    this._root = root;
    this._path = path;
  }

  path(): AnvilAstNodePath {
    return [...this._path];
  }

  isRoot(): boolean {
    return this._path.length === 0;
  }

  root(): AnvilAstNode {
    if (this._rootCache) {
      return this._rootCache;
    }

    let node: AnvilAstNode = this;
    while (!node.isRoot()) {
      node = node.up();
    }
    this._rootCache = node;
    return node;
  }

  traverse(...relative: AnvilAstNodePath): AnvilAstNode {
    let current: AnvilAstNode = this;
    for (const key of relative) {
      switch (key) {
        case ".":
          continue; // No-op
        case "..":
          current = current.up();
          break;
        default:
          current = current.down(key);
      }
    }
    return current;
  }

  up(): AnvilAstNode {
    if (this._upCache) {
      return this._upCache;
    }
    if (this.isRoot()) {
      this._rootCache = this; // Cache root node
      return this; // Already at root, can't go up
    }

    const parentPath = this._path.slice(0, -1);
    const parentNode = new AnvilAstNode(this._root, parentPath);

    parentNode._rootCache = this._rootCache;
    parentNode._downCache[this._path[this._path.length - 1]] = this;
    this._upCache = parentNode;

    return parentNode;
  }

  down(key: string | number): AnvilAstNode {
    if (key in this._downCache) {
      return this._downCache[key];
    }

    const node = new AnvilAstNode(this._root, [...this._path, key]);
    node._upCache = this;
    node._rootCache = this._rootCache;
    this._downCache[key] = node;
    return node;
  }

  /* -------------------------
   * Node Resolution
   * ------------------------- */

  /**
   * Resolves and returns the flattened node at current path.
   */
  resolve(): unknown | null {
    if (this._resolveCache !== undefined) {
      return this._resolveCache;
    }

    if (this._path.length === 0) {
      this._resolveCache = this._root ?? null;
    }

    // Resolves parent and populates its resolution into its cache
    this.up().resolve();

    // Take parent's resolution and extract current node's value
    const key = this._path[this._path.length - 1];
    const upperResolveCache = this._upCache?._resolveCache;

    if (upperResolveCache && typeof upperResolveCache === "object" && key in upperResolveCache) {
      // Populate cache with node
      this._resolveCache = (upperResolveCache as any)[key];
    } else {
      // Key not found in parent --> this node doesn't exist!
      this._resolveCache = null;
    }

    return this._resolveCache;
  }

  /**
   * Resolves the node at current path and asserts it matches the provided schema.
   * Returns null if resolution fails or if the schema check fails.
   */
  resolveAs<T>(schema: z.ZodType<T>): T | null {
    const resolved = this.resolve();
    if (resolved === null) {
      return null;
    }

    const typeChecked = schema.safeParse(resolved);
    if (!typeChecked.success) {
      return null;
    }

    return typeChecked.data;
  }

  /* -------------------------
   * Convenience Accessors
   * ------------------------- */

  event(): string | null {
    const tid = this.traverse("action_event", "tid").resolveAs(z.number());
    const eid = this.traverse("action_event", "eid").resolveAs(z.number());
    if (tid !== null && eid !== null) {
      return `t${tid} e${eid}`;
    }

    return null;
  }

  span(): AnvilSpan | null {
    return this.traverse("span").resolveAs(AnvilSpanSchema) ?? null;
  }

  definition(): AnvilLocation | null {
    return this.definitions()[0] ?? null;
  }

  definitions(): AnvilLocation[] {
    const defSpan = this.traverse("def_span").resolveAs(AnvilDefSpanSchema.array()) ?? [];
    return defSpan.map((d) => new AnvilLocation(d.cunit || this._root.file_name, d));
  }
}


/**
 * AnvilAst is the main class representing the entire AST of Anvil compilation units.
 *
 * It provides methods for navigating to specific nodes based on source locations,
 * looking up definitions and references, and extracting location information from nodes, and more.
 */
export class AnvilAst {
  private readonly roots: Map<string, AnvilAstNode> = new Map();

  /** filename -> sorted array of all locations in file */
  private readonly orderedLocations: Map<string, AnvilLocation[]> = new Map();

  /** loc-uid -> path from root to node */
  private readonly astNodePathIndex: Map<string, AnvilAstNodePath> = new Map();

  /** loc-uid (source definition) -> referrers */
  private readonly referenceIndex: Map<string, AnvilLocation[]> = new Map();

  /** loc-uid (parent) -> subfields locations */
  private readonly subfieldIndex: Map<string, AnvilLocation[]> = new Map();

  /**
   * Parser for Anvil AST output. Accepts a raw AST output (already parsed from JSON),
   * flattens the AST, validates it against the expected schema, and constructs an AnvilAst instance.
   *
   * @param units Raw AST output from Anvil compiler (already parsed from JSON).
   * @returns An instance of AnvilAst if parsing and validation succeed.
   * @throws If the input does not match the expected schema or if there is an error during parsing.
   */
  public static parse(units: AnvilCompUnit[] | unknown): AnvilAst {
    const parsed = AnvilCompUnitSchema.array().parse(AnvilAst.deepFlattenNode(units));
    return new AnvilAst(parsed);
  }

  /**
   * Constructs an AnvilAst instance from an array of AnvilCompUnit objects.
   */
  private constructor(units: AnvilCompUnit[]) {
    for (const unit of units) {
      const rootNode = new AnvilAstNode(unit, []);
      this.roots.set(unit.file_name, rootNode);
      this.orderedLocations.set(unit.file_name, []);
      this.deepMapNode(rootNode.resolve(), unit.file_name, []);
      this.sortLocations(unit.file_name);
    }
  }


  /* -------------------------
   * Navigation To Node
   * ------------------------- */

  goTo(loc: AnvilLocation): AnvilAstNode | null {
    const root = this.roots.get(loc.filename);
    if (!root) {
      return null;
    }

    const locUid = loc.id();
    const path = this.astNodePathIndex.get(locUid);
    if (!path) {
      return null;
    }
    return root.traverse(...path);
  }

  goToRoot(filename: string): AnvilAstNode | undefined {
    return this.roots.get(filename);
  }

  goToClosest(filename: string, line: number, col: number): AnvilAstNode | null {
    const closestLoc = this.findClosestLocation(filename, line, col);
    if (!closestLoc) {
      return null;
    }
    return this.goTo(closestLoc);
  }


  /* -------------------------
   * Reference Lookup
   * ------------------------- */

  definitionsOf(loc: AnvilLocation, filterCond?: AnvilLocationFilter): Readonly<AnvilLocation[]> {
    const node = this.goTo(loc);
    if (!node) {
      return [];
    }
    return node.definitions().filter(filterCond ?? (() => true));
  }

  referencesTo(loc: AnvilLocation, filterCond?: AnvilLocationFilter): Readonly<AnvilLocation[]> {
    const refs = this.referenceIndex.get(loc.id());
    if (!refs) {
      return [];
    }
    return refs.filter(filterCond ?? (() => true));
  }

  subfieldsOf(loc: AnvilLocation, filterCond?: AnvilLocationFilter): Readonly<AnvilLocation[]> {
    const subfields = this.subfieldIndex.get(loc.id());
    if (!subfields) {
      return [];
    }
    return subfields.filter(filterCond ?? (() => true));
  }


  /* -------------------------
   * Location Extraction
   * ------------------------- */

  findLocation(node: AnvilAstNode): AnvilLocation | null {
    const span = node.span();
    if (!span) return null;

    const filename = node.root().resolveAs(AnvilCompUnitSchema)?.file_name;
    if (!filename) return null;

    return new AnvilLocation(filename, span);
  }

  findClosestLocation(filename: string, line: number, col: number): AnvilLocation | null {
    // Binary search for closest location in the file
    const locations = this.orderedLocations.get(filename);
    if (!locations || locations.length === 0) {
      return null;
    }

    let left = 0;
    let right = locations.length - 1;
    let best: AnvilLocation | null = null;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const loc = locations[mid];

      if (loc.span.start.line < line || (loc.span.start.line === line && loc.span.start.col <= col)) {
        best = loc; // This location is a candidate
        left = mid + 1; // Search right half for a closer match
      } else {
        right = mid - 1; // Search left half
      }
    }

    return best;
  }


  /* -------------------------
   * Internal Utilities
   * ------------------------- */

  private sortLocations(fname: string): void {
    const orderedLocations = this.orderedLocations.get(fname);
    if (!orderedLocations) return;

    orderedLocations.sort((a, b) => {
      if (a.filename !== b.filename) {
        return a.filename.localeCompare(b.filename);
      }
      if (a.span.start.line !== b.span.start.line) {
        return a.span.start.line - b.span.start.line;
      }
      if (a.span.start.col !== b.span.start.col) {
        return a.span.start.col - b.span.start.col;
      }
      if (a.span.end.line !== b.span.end.line) {
        return a.span.end.line - b.span.end.line;
      }
      return a.span.end.col - b.span.end.col;
    });
  }

  private deepMapNode(node: unknown, fname: string, path: AnvilAstNodePath = []): void {
    if (node instanceof AnvilAstNode) {
      throw new Error("Unexpected AnvilAstNode instance during deepMapNode traversal");
    }

    (() => {
      const spannableNode = AnvilSpannableSchema.safeParse(node);
      if (spannableNode.success) {
        const spannable = spannableNode.data;
        const location = new AnvilLocation(fname, spannable.span);

        this.astNodePathIndex.set(location.id(), path);
        this.orderedLocations.get(fname)!.push(location);

        // Populate reference index for reverse definition lookup
        const defSpans = spannable.def_span ?? [];
        for (const defSpan of defSpans) {
          const defLocation = new AnvilLocation(defSpan.cunit || fname, defSpan);
          const defLocId = defLocation.id();
          if (!this.referenceIndex.has(defLocId)) {
            this.referenceIndex.set(defLocId, []);
          }
          this.referenceIndex.get(defLocId)!.push(location);
        }

        // Populate subfield index for structured nodes
        // === TODO ===
      }
    })()

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const child = node[i];
        this.deepMapNode(child, fname, [...path, i]);
      }
      return;
    }

    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        const child = (node as any)[key];
        this.deepMapNode(child, fname, [...path, key]);
      }
      return;
    }

    return;
  }

  private static deepFlattenNode(node: unknown): unknown {
    const flatten = (node: any) => {
      if (
        node &&
        typeof node === "object" &&
        node.kind === "ast_node" &&
        node.data &&
        typeof node.data === "object"
      ) {
        const { kind: _, data, ...rest } = node;
        return {
          kind: data.kind || node.kind,
          ...rest,
          ...data,
        };
      }
      return node;
    }

    const deepFlatten = (node: any): any => {
      const flattened = flatten(node);
      if (Array.isArray(flattened)) {
        return flattened.map((item) => deepFlatten(item));
      }
      if (flattened && typeof flattened === "object") {
        for (const key of Object.keys(flattened)) {
          flattened[key] = deepFlatten(flattened[key]);
        }
      }
      return flattened;
    }

    return deepFlatten(node);
  }
}
