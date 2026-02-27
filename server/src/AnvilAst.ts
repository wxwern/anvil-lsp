import path from "path";
import { z } from "zod";


const AnvilPosSchema = z.object({ line: z.number(), col: z.number() });
export type AnvilPos = z.infer<typeof AnvilPosSchema>;

const AnvilSpanSchema = z.object({
  start: AnvilPosSchema,
  end: AnvilPosSchema,
});
export type AnvilSpan = z.infer<typeof AnvilSpanSchema>;

const AnvilDefSpanSchema = AnvilSpanSchema.extend({
  file_name: z.string().nullable().optional(),
});
export type AnvilDefSpan = z.infer<typeof AnvilDefSpanSchema>;

const AnvilSpannableSchema = z.object({
  kind: z.string().optional(),
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

export class AnvilAbsoluteLocation {
  public readonly basepath: string;
  public readonly filepath: string;
  public readonly span: Readonly<AnvilSpan>;

  constructor(basepath: string, filepath: string, span: AnvilSpan) {
    this.basepath = basepath;
    this.filepath = filepath;

    if (this.filepath.startsWith("/")) {
      this.filepath = path.relative(this.basepath, this.filepath);
    }

    this.span = span;
  }

  get fullpath(): string {
    return path.join(this.basepath, this.filepath);
  }

  id(): string {
    const cs = this.span;
    return `${this.fullpath}:${cs.start.line}:${cs.start.col}-${cs.end.line}:${cs.end.col}`;
  }
}

export type AnvilAbsoluteLocationFilter = (loc: AnvilAbsoluteLocation) => boolean;

export class AnvilAstNode {
  private readonly _root: AnvilCompUnit;
  private readonly _path: AnvilAstNodePath;
  private readonly _fsBasepath: string;

  private _rootCache: AnvilAstNode | undefined = undefined;
  private _upCache: AnvilAstNode | undefined = undefined;
  private _downCache: { [key: string]: AnvilAstNode } = {};
  private _resolveCache: unknown | null | undefined = undefined;

  constructor(fsBasepath: string, root: AnvilCompUnit, path: AnvilAstNodePath = []) {
    this._fsBasepath = fsBasepath;
    this._root = root;
    this._path = path;
  }

  get path(): AnvilAstNodePath {
    return [...this._path];
  }

  get isRoot(): boolean {
    return this._path.length === 0;
  }

  get root(): AnvilAstNode {
    if (this._rootCache) {
      return this._rootCache;
    }

    let node: AnvilAstNode = this;
    while (!node.isRoot) {
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
    if (this.isRoot) {
      this._rootCache = this; // Cache root node
      return this; // Already at root, can't go up
    }

    const parentPath = this._path.slice(0, -1);
    const parentNode = new AnvilAstNode(this._fsBasepath, this._root, parentPath);

    parentNode._rootCache = this._rootCache;
    parentNode._downCache[this._path[this._path.length - 1]] = this;
    this._upCache = parentNode;

    return parentNode;
  }

  down(key: string | number): AnvilAstNode {
    if (key in this._downCache) {
      return this._downCache[key];
    }

    const node = new AnvilAstNode(this._fsBasepath, this._root, [...this._path, key]);
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
    if (this._path.length === 0) {
      this._resolveCache = this._root ?? null;
    }

    if (this._resolveCache !== undefined) {
      return this._resolveCache;
    }

    // Take parent's resolution and extract current node's key
    const key = this._path[this._path.length - 1];
    const upper = this.up().resolve();

    if (upper && typeof upper === "object" && key in upper) {
      // Populate cache with node
      this._resolveCache = (upper as any)[key];
    } else {
      // Key not found in parent --> this node doesn't exist!
      return null;
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

  /**
   * Resolves the root node of the AST.
   */
  resolveRoot(): AnvilCompUnit {
    return this.root.resolveAs(AnvilCompUnitSchema)!;
  }

  /* -------------------------
   * Convenience Accessors
   * ------------------------- */

  get event(): string | null {
    const tid = this.traverse("event", "tid").resolveAs(z.number());
    const eid = this.traverse("event", "eid").resolveAs(z.number());
    if (tid !== null && eid !== null) {
      return `t${tid} e${eid}`;
    }

    return null;
  }

  get span(): AnvilSpan | null {
    return this.traverse("span").resolveAs(AnvilSpanSchema) ?? null;
  }

  get location(): AnvilAbsoluteLocation | null {
    const span = this.span;
    if (!span) return null;

    const filename = this.resolveRoot()?.file_name;
    if (!filename) return null;

    return new AnvilAbsoluteLocation(this._fsBasepath, filename, span);
  }

  get definition(): AnvilAbsoluteLocation | null {
    return this.definitions[0] ?? null;
  }

  get definitions(): AnvilAbsoluteLocation[] {
    const defSpan = this.traverse("def_span").resolveAs(AnvilDefSpanSchema.array()) ?? [];
    return defSpan.map((d) => new AnvilAbsoluteLocation(this._fsBasepath, d.file_name || this._root.file_name, d));
  }
}


/**
 * AnvilAst is the main class representing the entire AST of Anvil compilation units.
 *
 * It provides methods for navigating to specific nodes based on source locations,
 * looking up definitions and references, and extracting location information from nodes, and more.
 */
export class AnvilAst {

  public readonly initDate: Date = new Date();

  private readonly roots: Map<string, AnvilAstNode> = new Map();

  /** filename -> sorted array of all locations in file */
  private readonly orderedLocations: Map<string, AnvilAbsoluteLocation[]> = new Map();

  /** loc-uid -> path from root to node */
  private readonly astNodePathIndex: Map<string, AnvilAstNodePath> = new Map();

  /** loc-uid (source definition) -> referrers */
  private readonly referenceIndex: Map<string, AnvilAbsoluteLocation[]> = new Map();

  /** loc-uid (parent) -> subfields locations */
  private readonly subfieldIndex: Map<string, AnvilAbsoluteLocation[]> = new Map();

  /**
   * Parser for Anvil AST output. Accepts a raw AST output (already parsed from JSON),
   * flattens the AST, validates it against the expected schema, and constructs an AnvilAst instance.
   *
   * @param fsBasepath The base path for resolving file paths in the AST.
   * @param units Raw AST output from Anvil compiler (already parsed from JSON).
   * @returns An instance of AnvilAst if parsing and validation succeed.
   * @throws If the input does not match the expected schema or if there is an error during parsing.
   */
  public static parse(fsBasepath: string, units: AnvilCompUnit[] | unknown): AnvilAst {
    const parsed = AnvilCompUnitSchema.array().parse(AnvilAst.deepFlattenNode(units));
    return new AnvilAst(fsBasepath, parsed);
  }

  /**
   * Constructs an AnvilAst instance from an array of AnvilCompUnit objects.
   */
  private constructor(fsBasepath: string, units: AnvilCompUnit[]) {
    for (const unit of units) {

      const rootNode = new AnvilAstNode(fsBasepath, unit, []);

      this.roots.set(unit.file_name, rootNode);
      this.orderedLocations.set(unit.file_name, []);

      const mappedCount = this.deepMapNode(rootNode.resolve(), fsBasepath, unit.file_name, []);
      console.log(`Processed and mapped ${mappedCount} nodes for file ${unit.file_name}`);

      this.sortLocations(unit.file_name);
    }
  }


  /* -------------------------
   * Navigation To Node
   * ------------------------- */

  goTo(loc: AnvilAbsoluteLocation): AnvilAstNode | null {
    const root = this.roots.get(loc.fullpath);
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

  definitionsOf(loc: AnvilAbsoluteLocation, filterCond?: AnvilAbsoluteLocationFilter): Readonly<AnvilAbsoluteLocation[]> {
    const node = this.goTo(loc);
    if (!node) {
      return [];
    }
    return node.definitions.filter(filterCond ?? (() => true));
  }

  referencesTo(loc: AnvilAbsoluteLocation, filterCond?: AnvilAbsoluteLocationFilter): Readonly<AnvilAbsoluteLocation[]> {
    const refs = this.referenceIndex.get(loc.id());
    if (!refs) {
      return [];
    }
    return refs.filter(filterCond ?? (() => true));
  }

  subfieldsOf(loc: AnvilAbsoluteLocation, filterCond?: AnvilAbsoluteLocationFilter): Readonly<AnvilAbsoluteLocation[]> {
    const subfields = this.subfieldIndex.get(loc.id());
    if (!subfields) {
      return [];
    }
    return subfields.filter(filterCond ?? (() => true));
  }

  getAll(filename?: string, filterCond?: AnvilAbsoluteLocationFilter): Readonly<AnvilAbsoluteLocation[]> {

    if (!filename) {
      const filenames = Array.from(this.orderedLocations.keys());
      if (filenames.length === 0) {
        return [];
      }
      let results = [];
      for (const fname of filenames) {
        results.push(...this.getAll(fname, filterCond));
      }
      return results;
    }

    const locations = this.orderedLocations.get(filename);
    console.log(`Getting all locations for file ${filename}, total found: ${locations?.length ?? 0}`);
    for (const loc of locations ?? []) {
      const node = this.goTo(loc);
      if (!node) {
        continue;
      }
    }

    return (locations ?? []).filter(filterCond ?? (() => true));

  }

  /* -------------------------
   * Location Extraction
   * ------------------------- */

  findLocation(node: AnvilAstNode): AnvilAbsoluteLocation | null {
    return node.location;
  }

  findClosestLocation(filename: string, line: number, col: number): AnvilAbsoluteLocation | null {
    console.log(`Search: closest AST node in ${filename} to line ${line}, col ${col}`);

    // Binary search for closest location in the file
    const locations = this.orderedLocations.get(filename);

    if (!locations || locations.length === 0) {
      return null;
    }

    let best: { loc: AnvilAbsoluteLocation, size: number } | null = null;

    for (const loc of locations) {
      const isBefore = loc.span.end.line < line || (loc.span.end.line === line && loc.span.end.col < col);
      if (isBefore) {
        continue;
      }

      const isAfter = loc.span.start.line > line || (loc.span.start.line === line && loc.span.start.col > col);
      if (isAfter) {
        continue;
      }

      const size = (loc.span.end.line - loc.span.start.line) * 1000 + (loc.span.end.col - loc.span.start.col);

      if (!best || size < best.size) {
        best = { loc, size };
      }
    }

    console.log(`Closest location found: ${best ? best.loc.id() : "none"}`);

    return best?.loc ?? null;
  }

  /* --------------------------
   * Helpers
   * ------------------------- */

  resolveRoot(filename: string): AnvilCompUnit | null {
    const rootNode = this.roots.get(filename);
    if (!rootNode) {
      return null;
    }
    return rootNode.resolveRoot();
  }

  /* -------------------------
   * Internal Utilities
   * ------------------------- */

  private sortLocations(fname: string): void {
    const orderedLocations = this.orderedLocations.get(fname);
    if (!orderedLocations) return;

    orderedLocations.sort((a, b) => {
      if (a.fullpath !== b.fullpath) {
        return a.fullpath.localeCompare(b.fullpath);
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

  private deepMapNode(node: unknown, fbasepath: string, fpath: string, path: AnvilAstNodePath = []): number {
    if (node instanceof AnvilAstNode) {
      throw new Error("Unexpected AnvilAstNode instance during deepMapNode traversal");
    }

    (() => {
      const spannableNode = AnvilSpannableSchema.safeParse(node);
      if (spannableNode.success) {
        const spannable = spannableNode.data;
        const location = new AnvilAbsoluteLocation(fbasepath, fpath, spannable.span);

        this.astNodePathIndex.set(location.id(), path);
        this.orderedLocations.get(fpath)!.push(location);

        // Populate reference index for reverse definition lookup
        const defSpans = spannable.def_span ?? [];
        for (const defSpan of defSpans) {
          const defLocation = new AnvilAbsoluteLocation(fbasepath, defSpan.file_name || fpath, defSpan);
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

    // Recursively map child list nodes
    if (Array.isArray(node)) {
      let sum = 0;
      for (let i = 0; i < node.length; i++) {
        const child = node[i];
        sum += this.deepMapNode(child, fbasepath, fpath, [...path, i]);
      }
      return 1 + sum;
    }

    // Recursively map child object nodes
    if (node && typeof node === "object") {
      let sum = 0;
      for (let key in node) {

        if (["event_graphs"].includes(key)) {
          // Skip deep mapping, is supplementary data only.
          continue;
        }

        const child = (node as any)[key];
        sum += this.deepMapNode(child, fbasepath, fpath, [...path, key]);
      }
      return 1 + sum;
    }

    return 1;
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
