import path from 'path';
import { z } from 'zod';

import {
  AnvilSpanSchema,
  AnvilDefSpanSchema,
  AnvilSpannableSchema,
  AnvilCompUnitSchema,
  type AnvilSpan,
  type AnvilCompUnit,
} from './schema';
import { astLogger } from '../../utils/logger';

/**
 * AnvilAbsoluteSpan represents a specific span of source code of a specifc Anvil compilation unit.
 * This contains the exact file path and the span (start and end line/column) of the code corresponding to an AST node.
 */
export class AnvilAbsoluteSpan {
  public readonly basepath: string;
  public readonly filepath: string;
  public readonly span: Readonly<AnvilSpan>;

  constructor(basepath: string, filepath: string, span: AnvilSpan) {
    this.basepath = basepath;
    this.filepath = filepath;

    if (this.filepath.startsWith('/')) {
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

type AnvilAbsoluteSpanFilter = (loc: AnvilAbsoluteSpan) => boolean;

/**
 * AnvilAstNodePath represents the path from the root of an AST to a specific node.
 */
export type AnvilAstNodePath = (string | number)[];

type AnvilAstKeyL0 = keyof AnvilCompUnit;
type AnvilAstKeyL1 = keyof AnvilCompUnit[AnvilAstKeyL0];
type AnvilAstKeyL2 = keyof AnvilCompUnit[AnvilAstKeyL0][AnvilAstKeyL1];
type AnvilAstKeyL3 =
  keyof AnvilCompUnit[AnvilAstKeyL0][AnvilAstKeyL1][AnvilAstKeyL2];
type AnvilAstKeyL4 =
  keyof AnvilCompUnit[AnvilAstKeyL0][AnvilAstKeyL1][AnvilAstKeyL2][AnvilAstKeyL3];
type AnvilAstKeyL5 =
  keyof AnvilCompUnit[AnvilAstKeyL0][AnvilAstKeyL1][AnvilAstKeyL2][AnvilAstKeyL3][AnvilAstKeyL4];

/**
 * AnvilAstNodeAbsolutePath represents a path from the root of an AST to a specific node,
 * with the keys at each level explicitly typed according to the AnvilCompUnit schema.
 */
export type AnvilAstNodeAbsolutePath = AnvilAstNodePath & {
  0?: AnvilAstKeyL0;
  1?: AnvilAstKeyL1;
  2?: AnvilAstKeyL2;
  3?: AnvilAstKeyL3;
  4?: AnvilAstKeyL4;
  5?: AnvilAstKeyL5;
};

/**
 * AnvilEventInfo represents the unique identifier of an event in Anvil,
 * consisting of its thread ID (tid), event ID (eid),
 * optional possible delays since start, and optional possible delay until next event.
 */
export type AnvilEventInfo = {
  tid: number;
  eid: number;
  prevDelays?: number[];
  nextDelay?: number;
};

/**
 * AnvilAstNode represents a lazily-resolved node in the AST of an Anvil compilation unit.
 *
 * It provides methods for navigating the AST, resolving nodes, and extracting information such as names, kinds, types, spans, and definitions.
 *
 * It has compile-time generic type parameter T representing the expected type of the resolved node at this path,
 * allowing for type-safe access to node properties after resolution. If omitted, T defaults to `any`,
 * which disables compile-time type safety guarantees (you can still use runtime checks like `resolveAs(schema)`).
 *
 * It also has a generic type parameter U representing the expected type of the parent node. You should not populate this type parameter
 * manually - it is automatically inferred and populated when you navigate the AST using the `up()`  and `down(_:)` methods.
 *
 * Each AnvilAstNode is associated with a specific path from the root of the AST, allowing for efficient navigation and resolution.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic type parameter default for flexibility
export class AnvilAstNode<T = any, U extends AnvilAstNode | unknown = unknown> {
  private readonly _root: AnvilCompUnit;
  private readonly _eventIdCycleDelayLookup:
    | { [proc: string]: { [tid: number]: { [eid: number]: number[] } } }
    | undefined = undefined;

  private readonly _path: AnvilAstNodeAbsolutePath;
  private readonly _fsBasepath: string;

  private _rootCache: AnvilAstNode<AnvilCompUnit> | undefined = undefined;
  private _upCache: U | undefined = undefined;
  private _downCache: { [key: string | number]: AnvilAstNode } = {};
  private _resolveCache?: unknown extends T ? unknown : T | null;

  private constructor(
    fsBasepath: string,
    root: AnvilCompUnit,
    path: AnvilAstNodeAbsolutePath = [],
  ) {
    this._fsBasepath = fsBasepath;
    this._root = root;
    this._path = path;
    this._eventIdCycleDelayLookup = {};

    if (!this._root.file_name) {
      throw new Error('Root compilation unit must have a file_name');
    }

    for (const graph of root.event_graphs ?? []) {
      const procName = graph.proc_name;
      if (!this._eventIdCycleDelayLookup[procName]) {
        this._eventIdCycleDelayLookup[procName] = {};
      }

      for (const thread of graph.threads) {
        const tid = thread.tid;
        if (!this._eventIdCycleDelayLookup[procName][tid]) {
          this._eventIdCycleDelayLookup[procName][tid] = {};
        }

        for (const event of thread.events) {
          const eid = event.eid;
          this._eventIdCycleDelayLookup[procName][tid][eid] = event.delays;
        }
      }
    }
  }

  /**
   * Factory method to create an AnvilAstNode from a given AnvilCompUnit. This will be the root node of the AST.
   *
   * @param fsBasepath The base path for resolving file paths in the AST.
   * @param root The AnvilCompUnit representing the root of the AST.
   * @returns An instance of AnvilAstNode representing the root of the AST.
   */
  public static of(
    fsBasepath: string,
    root: AnvilCompUnit,
  ): AnvilAstNode<AnvilCompUnit> {
    return new AnvilAstNode(fsBasepath, root, []);
  }

  /**
   * The path from the root of the AST to this node,
   * represented as an array of keys (string for object properties, number for array indices).
   *
   * This path can be used to navigate from the root node to this node by following the keys in order.
   */
  get nodepath(): AnvilAstNodeAbsolutePath {
    return [...this._path];
  }

  /**
   * The file path of the compilation unit this node belongs to, relative to the base path.
   */
  get filepath(): string {
    return this.resolveRoot().file_name!; // Root node must have file_name, guaranteed by constructor
  }

  /**
   * Indicates whether this node is the root of the AST.
   *
   * A root node has an empty {nodepath}.
   */
  isRoot(): this is AnvilAstNode<AnvilCompUnit> {
    return this._path.length === 0;
  }

  /**
   * Indicates whether this node is a leaf node (i.e., it has no children).
   *
   * A leaf node is defined as a node whose resolved value is not an object, or is null, or is an empty object.
   */
  isLeaf(): boolean {
    const node = this.resolve();
    return (
      typeof node !== 'object' ||
      node === null ||
      Object.keys(node).length === 0
    );
  }

  /**
   * Indicates whether this node is labelled with a {kind} that represents a
   * specific AST node type.
   *
   * This excludes unlabelled AST nodes that were unable to be flattened
   * (which have the synthetic kind '_ast_node').
   */
  get isLabelled(): boolean {
    const kind = this.kind;
    return !!kind && kind !== '_ast_node';
  }

  /**
   * Returns the root node of the AST. This is the node corresponding to the entire compilation unit.
   *
   * The root node is cached after the first lookup for efficient subsequent access.
   */
  get root(): AnvilAstNode<AnvilCompUnit> {
    if (this._rootCache) {
      return this._rootCache;
    }

    let node: AnvilAstNode = this;
    while (!node.isRoot()) {
      node = (node as AnvilAstNode).up();
    }
    this._rootCache = node as AnvilAstNode<AnvilCompUnit>;
    return this._rootCache;
  }

  /**
   * Returns ALL children of this node.
   *
   * - For array nodes, children are indexed by their array index.
   * - For object nodes, children are indexed by their property keys.
   * - For leaf nodes, no children will be returned (there are none).
   */
  get children(): T extends unknown[]
    ? AnvilAstNode<T[number]>[]
    : AnvilAstNode<T[keyof T]>[] {
    const resolved = this.resolve();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Array of child nodes with unknown element types
    let childNodes: AnvilAstNode<any>[] = [];

    if (Array.isArray(resolved)) {
      childNodes = resolved.map((_, idx) => this.down(idx as keyof T));
    } else if (typeof resolved === 'object') {
      for (const key in resolved) {
        childNodes.push(this.down(key));
      }
    }

    return childNodes as T extends unknown[]
      ? AnvilAstNode<T[number]>[]
      : AnvilAstNode<T[keyof T]>[];
  }

  /**
   * Traverses the AST from the current node using a relative path of keys, returning the resulting node.
   *
   * This operation has no compile-time safety guarantees and allows for special operators "." and "..".
   *
   * You can use it to traverse to any node in the AST relative to the current node,
   * but TS compile-time type resolution of expected data in this node will be `unknown`.
   * For stronger guarantees, use the `up` and `down` methods to navigate the AST,
   * which guarantees explicit typing at each step.
   *
   * If the path is invalid (e.g., a key does not exist at some point in the path),
   * the `resolve` or `resolveAs` method will return `null`.
   *
   * The relative path can include:
   * - String keys for object properties
   * - Number keys for array indices
   * - Special keys:
   *   - "." to stay at the current node
   *   - ".." to move up to the parent node
   *
   * Example usage:
   * - `node.unsafeTraverse("field1", "field2")` to access `node.field1.field2`
   * - `node.unsafeTraverse(0, "field")` to access `node[0].field`
   * - `node.unsafeTraverse("..", "sibling")` to access the sibling node at `node.up().sibling`
   */
  unsafeTraverse(...relative: AnvilAstNodePath): AnvilAstNode<unknown> {
    let current: AnvilAstNode = this;
    for (const key of relative) {
      switch (key) {
        case '.':
          continue; // No-op
        case '..':
          current = current.up();
          break;
        default:
          current = current.down(key as keyof T);
      }
    }
    return current;
  }

  /**
   * Moves up to the parent node. If already at the root, returns itself.
   *
   * Parent nodes are cached for efficient subsequent access.
   *
   * This method asserts the parent's containing data if it were to be resolved,
   * which guarantees type-safety for any subsequent `up`, `down` or `resolve` calls.
   */
  up(): T extends AnvilCompUnit
    ? AnvilAstNode<AnvilCompUnit>
    : U & AnvilAstNode {
    if (this._upCache) {
      return this._upCache as T extends AnvilCompUnit
        ? AnvilAstNode<AnvilCompUnit>
        : U & AnvilAstNode;
    }

    if (this.isRoot()) {
      // Already at root, cannot go up --> return self
      return this.root as T extends AnvilCompUnit
        ? AnvilAstNode<AnvilCompUnit>
        : U & AnvilAstNode;
    }

    const parentPath = this._path.slice(0, -1);
    const parentNode = new AnvilAstNode(
      this._fsBasepath,
      this._root,
      parentPath,
    ) as U & AnvilAstNode;

    parentNode._rootCache = this._rootCache;
    parentNode._downCache[this._path[this._path.length - 1]] =
      this as AnvilAstNode;
    this._upCache = parentNode;

    return parentNode as T extends AnvilCompUnit
      ? AnvilAstNode<AnvilCompUnit>
      : U & AnvilAstNode;
  }

  /**
   * Moves down to the child node specified by the given key.
   *
   * Child nodes are cached for efficient subsequent access.
   *
   * This method asserts the child node's containing data if it were to be resolved.
   * It guarantees type-safety for any subsequent `up`, `down` or `resolve` calls on the child node.
   *
   * Type checking will fail at compile time if the path traversal is possibly invalid,
   * resulting in TypeScript type error of the supplied key or AnvilAstNode<never>.
   * For instance, if this node does not have property "foo", or if this node is a
   * discriminated union of types where some have property "foo" and some don't,
   * then `down("foo")` will fail in compile-time.
   *
   * @param key The key of the child node to move down to.
   *            This can be a string (for object properties) or a number (for array indices).
   *
   * @returns The child AnvilAstNode corresponding to the given key.
   */
  down<K extends keyof T>(key: K): AnvilAstNode<T[K], AnvilAstNode<T, U>> {
    if (key in this._downCache) {
      return this._downCache[key as string | number] as AnvilAstNode<
        T[K],
        AnvilAstNode<T, U>
      >;
    }

    const node = new AnvilAstNode(this._fsBasepath, this._root, [
      ...this._path,
      key as string | number,
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Cache parent node with flexible typing
    node._upCache = this as any;
    node._rootCache = this._rootCache;
    this._downCache[key as string | number] = node;
    return node as AnvilAstNode<T[K], AnvilAstNode<T, U>>;
  }

  /**
   * Returns an iterable of all descendant nodes in the AST, including itself.
   *
   * The nodes are returned in depth-first pre-order traversal.
   */
  getAllDescendants(): Iterable<AnvilAstNode<unknown>> {
    const stack: AnvilAstNode[] = [this];
    return {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<AnvilAstNode<unknown>> {
            if (stack.length === 0) {
              return { done: true, value: undefined };
            }
            const current = stack.pop()!;
            stack.push(...current.children);
            return { done: false, value: current };
          },
        };
      },
    };
  }

  /* -------------------------
   * Type Resolution
   * ------------------------- */

  /**
   * Type-checks that the current node's data resolution satisfies the provided Zod schema - quickly, when possible.
   *
   * @param schema The Zod schema to check the resolved node against.
   * @param strict If true, performs a strict check that the resolved node matches the schema exactly.
   *               If false (default), performs a rapid type check that does not fully evaluate the schema,
   *               based on the `kind` field and `type` field when possible.
   *
   * @return `true` if the resolved node satisfies the schema, `false` otherwise.
   */
  satisfies<S>(
    schema: z.ZodType<S>,
    strict: boolean = false,
  ): this is AnvilAstNode<T & S, U> {
    const slowCheck = () => schema.safeParse(this.resolve()).success;

    if (strict) {
      return slowCheck();
    }

    const fieldCheck = (fieldName: string): boolean | null => {
      if (
        !(schema instanceof z.ZodObject) ||
        !(fieldName in schema.shape) ||
        !(schema.shape.kind instanceof z.ZodType)
      ) {
        return null;
      }

      const zodKind = schema.shape.kind;
      const inputKind = this.down(fieldName as keyof T).resolve();

      if (!inputKind && !zodKind) {
        return null;
      }

      const parseResult = zodKind?.safeParse(inputKind).success;
      astLogger.info(
        `Rapid schema check for node ${this} on field "${fieldName}" with input "${inputKind}" against schema ${zodKind} success: ${parseResult}`,
      );
      return !!parseResult;
    };

    const kind = fieldCheck('kind');
    const type = fieldCheck('type');

    if (kind === null) {
      return slowCheck();
    }

    return kind && (type ?? true);
  }

  /**
   * Returns the current node with an asserted type based on the provided Zod schema, if the schema check passes.
   * Otherwise, returns null. This uses a rapid check pathway (based on the presence of a "kind" and/or "type" field)
   * when possible.
   */
  satisfying<S>(schema: z.ZodType<S>): AnvilAstNode<T & S, U> | null {
    return this.satisfies(schema) ? this : null;
  }

  /**
   * Checks whether the current node has a "kind" field with the given value, without fully resolving the node's data.
   */
  satisfiesKind<S extends string>(
    kind: S,
  ): this is AnvilAstNode<T & { kind: S }, U> {
    const kindNode = this.down('kind' as keyof T);
    const resolvedKind = kindNode.resolve();
    return resolvedKind === kind;
  }

  /**
   * Returns the current node with an asserted type based on the presence of a "kind" field with the given value, if the check passes. Otherwise, returns null.
   */
  satisfyingKind<S extends string>(
    kind: S,
  ): AnvilAstNode<T & { kind: S }, U> | null {
    return this.satisfiesKind(kind) ? this : null;
  }

  /**
   * Checks whether the current node has a "type" field with the given value, without fully resolving the node's data.
   */
  satisfiesType<S extends string>(
    type: S,
  ): this is AnvilAstNode<T & { type: S }, U> {
    const typeNode = this.down('type' as keyof T);
    const resolvedType = typeNode.resolve();
    return resolvedType === type;
  }

  /**
   * Returns the current node with an asserted type based on the presence of a "type" field with the given value, if the check passes. Otherwise, returns null.
   */
  satisfyingType<S extends string>(
    type: S,
  ): AnvilAstNode<T & { type: S }, U> | null {
    return this.satisfiesType(type) ? this : null;
  }

  /* -------------------------
   * Node Resolution
   * ------------------------- */

  /**
   * Resolves and returns the flattened node at current path.
   */
  resolve(): unknown extends T ? unknown | null : T | null {
    if (this._path.length === 0) {
      this._resolveCache = (this._root as T) ?? null;
    }

    if (this._resolveCache !== undefined) {
      return this._resolveCache;
    }

    // Take parent's resolution and extract current node's key
    const key = this._path[this._path.length - 1];
    const upper = this.up().resolve();

    if (upper && typeof upper === 'object' && key in upper) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Validated by if condition
      this._resolveCache = (upper as any)[key];
    } else {
      // Key not found in parent --> this node doesn't exist!
      return null;
    }

    return this._resolveCache ?? null;
  }

  /**
   * Resolves the node at current path and asserts it matches the provided schema.
   * Returns null if resolution fails or if the schema check fails.
   */
  resolveAs<U extends T>(schema: z.ZodType<U>): Readonly<U> | null {
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
  resolveRoot(): Readonly<AnvilCompUnit> {
    // As root is always identical, we can use the cache for fastest lookup
    return this._root;
  }

  /* -------------------------
   * Convenience Accessors
   * ------------------------- */

  private get_event_prior_delays(tid: number, eid: number): number[] | null {
    const eventGraphLookup = this.root._eventIdCycleDelayLookup;
    if (!eventGraphLookup) {
      return null;
    }

    let procName: string | null = null;
    let current: AnvilAstNode | null = this;
    while (current) {
      const kind = current.kind;
      if (kind === 'proc_def') {
        procName = current.down('name').resolveAs(z.string()) ?? null;
        break;
      }
      if (current.isRoot()) {
        current = null;
      } else {
        current = (current as AnvilAstNode).up();
      }
    }

    if (!procName) {
      return null;
    }

    const result = eventGraphLookup?.[procName]?.[tid]?.[eid] ?? [];
    return result.length > 0 ? result : null;
  }

  /**
   * Obtains the unique event (tid, eid, and optional possible delays since start)
   * for the event corresponding to this node, if applicable.
   */
  get event(): AnvilEventInfo | null {
    const tid = this.unsafeTraverse('event', 'tid').resolveAs(z.number());
    const eid = this.unsafeTraverse('event', 'eid').resolveAs(z.number());
    const nextDelay = this.unsafeTraverse('event', 'cycles').resolveAs(
      z.number(),
    );

    if (tid === null || eid === null) {
      return null;
    }

    const delays = this.get_event_prior_delays(tid, eid);
    return {
      tid,
      eid,
      prevDelays: delays ?? undefined,
      nextDelay: nextDelay ?? undefined,
    };
  }

  /**
   * Obtains the event that this node is sustained till, if applicable.
   * This implies the node's execution spans until the occurrence of the target event (inclusive).
   */
  get sustainedTillEvent(): AnvilEventInfo | null {
    return null; // Placeholder. Current anvil build cycle reporting is broken.
  }

  /**
   * Obtains the unique name of this node, if it exists, and is unique.
   *
   * If this node has multiple names, this method returns `null` to avoid ambiguity.
   * Use the plural {names} property to obtain all names in this case.
   */
  get name(): string | null {
    return this.names.length === 1 ? this.names[0] : null;
  }

  /**
   * Obtains all names this node has. May return an empty list if none exists.
   */
  get names(): string[] {
    const name = this.unsafeTraverse('name').resolveAs(z.string());
    if (name !== null) {
      return [name];
    }

    const ids = this.unsafeTraverse('ids').resolveAs(z.string().array());
    if (ids !== null) {
      return [...ids];
    }

    switch (this.kind) {
      case 'channel_def': {
        const left = this.unsafeTraverse('endpoint_left').resolveAs(z.string());
        const right = this.unsafeTraverse('endpoint_right').resolveAs(
          z.string(),
        );
        return [left, right].filter((n): n is string => n !== null);
      }
    }

    return [];
  }

  /**
   * Obtains the span of this node, if it has a valid codespan.
   * Otherwise, returns null.
   */
  get span(): Readonly<AnvilSpan> | null {
    return this.unsafeTraverse('span').resolveAs(AnvilSpanSchema) ?? null;
  }

  /**
   * Obtains the kind of this node, if applicable. Otherwise, returns null.
   */
  get kind(): string | null {
    return this.unsafeTraverse('kind').resolveAs(z.string()) ?? null;
  }

  /**
   * Obtains the type of this node, if applicable. Otherwise, returns null.
   */
  get type(): string | null {
    return this.unsafeTraverse('type').resolveAs(z.string()) ?? null;
  }

  /**
   * Obtains the absolute span of this node, if it has a valid codespan.
   * Otherwise, returns null.
   *
   * The absolute span includes the full file path (resolved from the base path)
   * and the span (line/column information).
   */
  get absoluteSpan(): AnvilAbsoluteSpan | null {
    const span = this.span;
    if (!span) return null;

    const filepath = this.filepath;
    return new AnvilAbsoluteSpan(this._fsBasepath, filepath, span);
  }

  /**
   * Obtains the absolute span of the definition corresponding to this node,
   * if they exist.
   *
   * If multiple definitions exist, the first one (usually the most relevant) is returned.
   */
  get definition(): AnvilAbsoluteSpan | null {
    return this.definitions[0] ?? null;
  }

  /**
   * Obtains the absolute spans of all definitions corresponding to this node,
   * if they exist. May return an empty list if no definitions exist.
   */
  get definitions(): AnvilAbsoluteSpan[] {
    const defSpan =
      this.unsafeTraverse('def_span').resolveAs(AnvilDefSpanSchema.array()) ??
      [];
    return defSpan.map(
      (d) =>
        new AnvilAbsoluteSpan(
          this._fsBasepath,
          d.file_name || this.filepath,
          d,
        ),
    );
  }

  /**
   * Returns a string representation of this node for debugging purposes.
   */
  toString(): string {
    const pathStr = this.nodepath.map((p) => `[${p}]`).join('');
    const kindStr = this.kind ? ` (${this.kind})` : '';
    return `AnvilAstNode${pathStr}${kindStr}`;
  }
}

/**
 * AnvilAst is the top-level class representing every AST for every Anvil compilation unit.
 *
 * It provides methods for navigating to specific nodes based on source locations,
 * looking up definitions and references, and extracting location information from nodes, and more.
 */
export class AnvilAst {
  public readonly initDate: Date = new Date();

  private readonly roots: Map<string, AnvilAstNode<AnvilCompUnit>> = new Map();

  /** filename -> sorted array of all locations in file */
  private readonly orderedLocations: Map<string, AnvilAbsoluteSpan[]> =
    new Map();

  /** loc-uid -> path from root to node */
  private readonly astNodePathIndex: Map<string, AnvilAstNodePath> = new Map();

  /** loc-uid (source definition) -> referrers */
  private readonly referenceIndex: Map<string, AnvilAbsoluteSpan[]> = new Map();

  /** loc-uid (parent) -> subfields locations */
  private readonly subfieldIndex: Map<string, AnvilAbsoluteSpan[]> = new Map();

  /**
   * Parser for Anvil AST output. Accepts a raw AST output (already parsed from JSON),
   * flattens the AST, validates it against the expected schema, and constructs an AnvilAst instance.
   *
   * @param fsBasepath The base path for resolving file paths in the AST.
   * @param units Raw AST output from Anvil compiler (already parsed from JSON).
   * @returns An instance of AnvilAst if parsing and validation succeed.
   * @throws If the input does not match the expected schema or if there is an error during parsing.
   */
  public static parse(
    fsBasepath: string,
    units: AnvilCompUnit[] | unknown,
  ): AnvilAst {
    const parsed = AnvilCompUnitSchema.array().parse(
      AnvilAst.deepFlattenNode(units),
    );
    return new AnvilAst(fsBasepath, parsed);
  }

  /**
   * Constructs an AnvilAst instance from an array of AnvilCompUnit objects.
   */
  private constructor(fsBasepath: string, units: AnvilCompUnit[]) {
    for (const unit of units) {
      const rootNode = AnvilAstNode.of(fsBasepath, unit);

      const filename = unit.file_name;
      if (!filename) {
        throw new Error(
          'Compilation unit is missing a file_name: ' + JSON.stringify(unit),
        );
      }

      this.roots.set(filename, rootNode);
      this.orderedLocations.set(filename, []);

      const mappedCount = this.deepMapNode(
        rootNode.resolve(),
        fsBasepath,
        filename,
        [],
      );
      astLogger.info(
        `Processed and mapped ${mappedCount} nodes for file ${unit.file_name}`,
      );

      this.sortLocations(filename);
    }
  }

  /* -------------------------
   * Navigation To Node
   * ------------------------- */

  /**
   * Returns the AnvilAstNode corresponding to the given absolute span location, if it exists in the AST.
   */
  node(loc: AnvilAbsoluteSpan): AnvilAstNode<unknown> | null {
    const root = this.roots.get(loc.fullpath);
    if (!root) {
      return null;
    }

    const locUid = loc.id();
    const path = this.astNodePathIndex.get(locUid);
    if (!path) {
      return null;
    }
    return root.unsafeTraverse(...path);
  }

  /**
   * Returns the root AnvilAstNode for the given filename, if it exists in the AST.
   */
  root(filename: string): AnvilAstNode<AnvilCompUnit> | undefined {
    return this.roots.get(filename);
  }

  /**
   * Finds and returns the closest AnvilAstNode to the given source location (line and column)
   * within the specified file.
   *
   * For behavior details, see the `findClosestLocation` method.
   *
   * @param filename The name of the file to search within.
   * @param line The line number of the source location to find the closest node to.
   * @param col The column number of the source location to find the closest node to.
   * @param predicate Optional filter function to apply to candidate nodes.
   *                  Only nodes for which this function returns true will be considered.
   *
   * @returns An AnvilAstNode representing the closest AST node to the specified location
   */
  closestNode<U = unknown>(
    filename: string,
    line: number,
    col: number,
    predicate?: ((n: AnvilAstNode<unknown>) => boolean) | z.ZodType<U>,
  ): AnvilAstNode<U> | null {
    const _predicate =
      predicate instanceof z.ZodType
        ? (n: AnvilAstNode<unknown>) => {
            if (n.satisfies(predicate)) {
              astLogger.info(
                `Node ${n} satisfies schema predicate ${predicate}`,
              );
              return true;
            } else {
              astLogger.info(
                `Node ${n} does NOT satisfy schema predicate ${predicate}`,
              );
              return false;
            }
          }
        : predicate;

    const closestLoc = this.findClosestAbsoluteSpan(
      filename,
      line,
      col,
      _predicate
        ? (loc) => {
            const n = this.node(loc);
            astLogger.info(
              `Checking node at ${loc} for predicate, resolved node: ${n}`,
            );
            return !!n && _predicate(n);
          }
        : undefined,
    );
    if (!closestLoc) {
      return null;
    }
    return this.node(closestLoc) as AnvilAstNode<U> | null;
  }

  /* -------------------------
   * Reference Lookup
   * ------------------------- */

  /**
   * Returns the absolute spans of the definitions corresponding to the given location, if they exist.
   */
  definitionsOf(
    loc: AnvilAbsoluteSpan,
    filterCond?: AnvilAbsoluteSpanFilter,
  ): Readonly<AnvilAbsoluteSpan[]> {
    const node = this.node(loc);
    if (!node) {
      return [];
    }
    return node.definitions.filter(filterCond ?? (() => true));
  }

  /**
   * Returns the absolute spans of the references corresponding to the given location, if they exist.
   */
  referencesTo(
    loc: AnvilAbsoluteSpan,
    filterCond?: AnvilAbsoluteSpanFilter,
  ): Readonly<AnvilAbsoluteSpan[]> {
    const refs = this.referenceIndex.get(loc.id());
    if (!refs) {
      return [];
    }
    return refs.filter(filterCond ?? (() => true));
  }

  /**
   * Returns the absolute spans of the subfields corresponding to the given location, if they exist.
   */
  subfieldsOf(
    loc: AnvilAbsoluteSpan,
    filterCond?: AnvilAbsoluteSpanFilter,
  ): Readonly<AnvilAbsoluteSpan[]> {
    const subfields = this.subfieldIndex.get(loc.id());
    if (!subfields) {
      return [];
    }
    return subfields.filter(filterCond ?? (() => true));
  }

  /**
   * Returns all locatable nodes in the AST, optionally filtered by filename and/or a custom filter condition.
   *
   * A locatable node is any node that has an associated absolute span
   * (i.e., it corresponds to a specific location in the source code).
   *
   * @param filename Optional filename to filter nodes by. If provided, only nodes in this file will be returned.
   * @param filterCond Optional custom filter function to further filter nodes based on their absolute span.
   *
   * @return An array of AnvilAbsoluteSpan objects representing the locatable nodes that match the specified criteria.
   */
  getAllLocatableNodes(
    filename?: string,
    filterCond?: AnvilAbsoluteSpanFilter,
  ): Readonly<AnvilAbsoluteSpan[]> {
    if (!filename) {
      const filenames = Array.from(this.orderedLocations.keys());
      if (filenames.length === 0) {
        return [];
      }
      const results = [];
      for (const fname of filenames) {
        results.push(...this.getAllLocatableNodes(fname, filterCond));
      }
      return results;
    }

    const locations = this.orderedLocations.get(filename);
    astLogger.info(
      `Getting all locations for file ${filename}, total found: ${locations?.length ?? 0}`,
    );
    for (const loc of locations ?? []) {
      const node = this.node(loc);
      if (!node) {
        continue;
      }
    }

    return (locations ?? []).filter(filterCond ?? (() => true));
  }

  /**
   * Returns all root AST nodes, each corresponding to a different compilation unit (file).
   */
  getAllRoots(): Readonly<AnvilAstNode<AnvilCompUnit>[]> {
    return Array.from(this.roots.values());
  }

  /* -------------------------
   * Location Extraction
   * ------------------------- */

  /**
   * Extracts the absolute span associated with a given AST node, if available.
   *
   * @param node The AnvilAstNode for which to extract the location.
   * @returns An AnvilAbsoluteSpan representing the source location of the node, or null if no location is available.
   */
  findAbsoluteSpan(
    node: AnvilAstNode<AnvilCompUnit>,
  ): AnvilAbsoluteSpan | null {
    return node.absoluteSpan;
  }

  /**
   * Finds the closest AST node's absolute span to a given source location (line and column) within a specified file.
   *
   * The search can be optionally filtered by a custom predicate function that takes an
   * AnvilAbsoluteSpan and returns a boolean.
   *
   * The closest node is determined based on the _first node with the smallest codespan_ that
   * contains the specified line and column.
   *
   * @param filename The name of the file to search within.
   * @param line The line number of the source location to find the closest node to (1-based).
   * @param col The column number of the source location to find the closest node to (1-based).
   * @param predicate Optional filter function to apply to candidate nodes. Only nodes for which this function returns true will be considered.
   *
   * @returns An AnvilAbsoluteSpan representing the closest AST node to the specified location
   *          that satisfies the predicate, or `null` if no such node is found.
   */
  findClosestAbsoluteSpan(
    filename: string,
    line: number,
    col: number,
    predicate?: (l: AnvilAbsoluteSpan) => boolean,
  ): AnvilAbsoluteSpan | null {
    astLogger.info(
      `Search: closest AST node in ${filename} to line ${line}, col ${col}`,
    );

    const locations = this.orderedLocations.get(filename);

    if (!locations || locations.length === 0) {
      return null;
    }

    let best: { loc: AnvilAbsoluteSpan; size: number } | null = null;

    for (const loc of locations) {
      const isBefore =
        loc.span.end.line < line ||
        (loc.span.end.line === line && loc.span.end.col < col);
      if (isBefore) {
        continue;
      }

      const isAfter =
        loc.span.start.line > line ||
        (loc.span.start.line === line && loc.span.start.col > col);
      if (isAfter) {
        continue;
      }

      const size =
        (loc.span.end.line - loc.span.start.line) * 1000 +
        (loc.span.end.col - loc.span.start.col);

      if (!best || size < best.size) {
        if (predicate && !predicate(loc)) {
          continue;
        }

        best = { loc, size };
      }
    }

    astLogger.info(`Closest location found: ${best ? best.loc.id() : 'none'}`);

    return best?.loc ?? null;
  }

  /* --------------------------
   * Helpers
   * ------------------------- */

  /**
   * Resolves and returns the root compilation unit (AnvilCompUnit) for a given filename.
   *
   * @param filename The name of the file for which to resolve the root compilation unit.
   * @returns An AnvilCompUnit representing the root of the AST for the specified file, or null if no such file is found in the AST.
   */
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

  /**
   * Populates all lookup tables by traversing the entire AST starting from the given node.
   *
   * For each node, if it has a valid span, it is added to the `astNodePathIndex` and `orderedLocations`.
   * If it has definition spans, they are added to the `referenceIndex` for reverse lookup.
   *
   * The traversal is done in depth-first pre-order manner, and the path from the root to each node is
   * tracked and stored.
   *
   * @param node The current node being traversed.
   * @param fbasepath The base path for resolving file paths in the AST.
   * @param fpath The file path of the current compilation unit being processed.
   * @param path The path from the root to the current node, represented as an array of keys.
   * @returns The total number of nodes processed in this subtree (including the current node).
   */
  private deepMapNode(
    node: unknown,
    fbasepath: string,
    fpath: string,
    path: AnvilAstNodePath = [],
  ): number {
    if (node instanceof AnvilAstNode) {
      throw new Error(
        'Unexpected AnvilAstNode instance during deepMapNode traversal',
      );
    }

    (() => {
      const spannableNode = AnvilSpannableSchema.safeParse(node);
      if (spannableNode.success) {
        const spannable = spannableNode.data;
        const location = new AnvilAbsoluteSpan(
          fbasepath,
          fpath,
          spannable.span,
        );

        this.astNodePathIndex.set(location.id(), path);
        this.orderedLocations.get(fpath)!.push(location);

        // Populate reference index for reverse definition lookup
        const defSpans = spannable.def_span ?? [];
        for (const defSpan of defSpans) {
          const defLocation = new AnvilAbsoluteSpan(
            fbasepath,
            defSpan.file_name || fpath,
            defSpan,
          );
          const defLocId = defLocation.id();
          if (!this.referenceIndex.has(defLocId)) {
            this.referenceIndex.set(defLocId, []);
          }
          this.referenceIndex.get(defLocId)!.push(location);
        }

        // Populate subfield index for structured nodes
        // === TODO ===
      }
    })();

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
    if (node && typeof node === 'object') {
      let sum = 0;
      for (const key in node) {
        if (['event_graphs'].includes(key)) {
          // Skip deep mapping, is supplementary data only.
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Known to be valid per for-in loop
        const child = (node as any)[key];
        sum += this.deepMapNode(child, fbasepath, fpath, [...path, key]);
      }
      return 1 + sum;
    }

    return 1;
  }

  /**
   * Flattens unnecessarily nested AST nodes by merging the "kind" and "data" fields of each node
   * into a single object recursively.
   *
   * This cleans up the AST structure and makes information like codespan and definition spans
   * more directly accessible at the top level of each information node, together with all of its
   * other fields within data.
   *
   */
  private static deepFlattenNode(node: unknown): unknown {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recursively process unknown data structure
    const flatten = (node: any) => {
      if (node && typeof node === 'object' && node.kind === 'ast_node') {
        const { kind: _, data, ...rest } = node;

        if (typeof data === 'object' && !Array.isArray(data)) {
          return {
            kind: data.kind || '_ast_node',
            ...rest,
            ...data,
          };
        } else {
          return {
            kind: '_ast_node',
            type: Array.isArray(data)
              ? 'array'
              : data === null || data === undefined
                ? `unknown`
                : `${typeof data}`,
            ...rest,
            value: data,
          };
        }
      }
      return node;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recursive helper for deep flattening unknown structures
    const deepFlatten = (node: any): any => {
      const flattened = flatten(node);
      if (Array.isArray(flattened)) {
        return flattened.map((item) => deepFlatten(item));
      }
      if (flattened && typeof flattened === 'object') {
        for (const key of Object.keys(flattened)) {
          flattened[key] = deepFlatten(flattened[key]);
        }
      }
      return flattened;
    };

    return deepFlatten(node);
  }
}
