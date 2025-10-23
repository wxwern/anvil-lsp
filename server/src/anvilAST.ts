
export type AnvilSpan = {
  start: { line: number; col: number };
  end: { line: number; col: number };
};

export type AnvilUnknownNode = { [key: string]: any; };
export type AnvilSpannable = { kind: string; span: AnvilSpan; };
export type AnvilSpannableData = AnvilSpannable & { data?: any };

export type AnvilChannelClass = { kind: 'channel_class_def' } & AnvilSpannable & AnvilUnknownNode;
export type AnvilMessage = { kind: 'message_def' } & AnvilSpannable & AnvilUnknownNode;
export type AnvilType = { kind: 'type_def' } & AnvilSpannable & AnvilUnknownNode;
export type AnvilMacro = { kind: 'macro_def' } & AnvilSpannable & AnvilUnknownNode;
export type AnvilFunc = { kind: 'func_def' } & AnvilSpannable & AnvilUnknownNode;
export type AnvilProc = { kind: 'proc_def' } & AnvilSpannable & AnvilUnknownNode;

export type AnvilRegister = { kind: 'reg_def', name: string } & AnvilSpannable & AnvilUnknownNode;
export type AnvilEndpoint = { kind: 'endpoint_def', channel_class: string } & AnvilSpannable & AnvilUnknownNode;
export type AnvilChannel = { kind: 'channel_def', channel_class: string, endpoint_left: string, endpoint_right: string } & AnvilSpannable & AnvilUnknownNode;

export type AnvilAstNode = { kind: 'ast_node' | 'expr_node' } & AnvilSpannableData;
export type AnvilExpr = { kind: "expr", type: string } & AnvilUnknownNode;

export type AnvilCompUnit = {
  file_name: string;
  channel_classes: AnvilChannelClass[];
  type_defs: AnvilType[];
  macro_defs: AnvilMacro[];
  func_defs: AnvilFunc[];
  procs: AnvilProc[];
  imports: {
    file_name: string;
    is_extern: boolean;
    span: AnvilSpan;
  }[];
};

export type AnvilASTOutput = {
  file_name: string;
  compilation_unit: AnvilCompUnit;
};


export type AnvilCompUnitNav =
  (string | number)[] &
  { 0: keyof AnvilCompUnit } &
  { 1?: number };

export type AnvilCompUnitNavWithFilename = {
  filename: string;
  navigation: AnvilCompUnitNav;
}

export class AnvilAST {

  private data: AnvilASTOutput[];
  private filenameToIndex: { [filename: string]: number } = {};

  private spanToTreeNavigation: {
    [filename: string]: {
      span: AnvilSpan;
      navigation: AnvilCompUnitNav;
    }[];
  } = {};

  private identifierToTreeNavigation: {
    [identifier: string]: {
      filename: string;
      span: AnvilSpan;
      navigation: AnvilCompUnitNav;
    }[];
  } = {};

  constructor(data: AnvilASTOutput[]) {
    this.data = data;
    this.data.forEach((item, index) => {
      if (item.file_name) {
        this.filenameToIndex[item.file_name] = index;
        this.traverseAST(item.file_name, item.compilation_unit);
      }
    });

    for (const filename in this.spanToTreeNavigation) {
      this.spanToTreeNavigation[filename].sort((a, b) => {
        if (a.span.start.line !== b.span.start.line) {
          return a.span.start.line - b.span.start.line;
        }
        return a.span.start.col - b.span.start.col;
      });
    }
  }

  static fromJSONString(json: string): AnvilAST {
    // TODO: Validation
    return new AnvilAST(JSON.parse(json) as AnvilASTOutput[]);
  }

  /**
   * Get the navigation path to a specific span.
   * @param span The span to find navigation for
   * @returns An array of navigation steps or null if not found
   */
  getNavigationToSpan(filename: string, span: AnvilSpan): AnvilCompUnitNav | null {
    let bestMatch: {
      span: AnvilSpan;
      navigation: AnvilCompUnitNav;
    } | null = null;

    for (const entry of this.spanToTreeNavigation[filename] || []) {
      if (this.isSpanBefore(entry.span, span)) { continue; }
      if (this.isSpanAfter(entry.span, span)) { continue; }

      // Current entry.span encloses span!

      if (!bestMatch) {
        // First match
        bestMatch = entry;
      } else {
        // Another match exists
        // Check if this is a narrower match, if so, use it
        const bestSpan = bestMatch.span;
        const entrySpan = entry.span;

        const bestSize = (bestSpan.end.line - bestSpan.start.line) * 1000 + (bestSpan.end.col - bestSpan.start.col);
        const entrySize = (entrySpan.end.line - entrySpan.start.line) * 1000 + (entrySpan.end.col - entrySpan.start.col);

        if (entrySize < bestSize) {
          bestMatch = entry;
        }
      }
    }

    // Return the best match found, if any
    if (bestMatch) {
      return bestMatch.navigation;
    }

    return null;
  }

  /**
   * Get the navigation path to a specific location (line and character number).
   * @param line The line number (1-based)
   * @param cnum The character number (1-based)
   * @returns An array of navigation steps or null if not found
   */
  getNavigationToLocation(filename: string, line: number, col: number): AnvilCompUnitNav | null {
    return this.getNavigationToSpan(filename, {
      start: { line, col },
      end: { line, col },
    });
  }

  /**
   * Get the AST node at a specific navigation path.
   * @param navigation The navigation path as an array of steps
   * @param traverseUpward A function that determines whether to traverse upward in the AST. Useful for getting out of nested structures.
   * @param requireSpannableNode If true, will traverse one level up to locate nodes with code spans.
   * @returns The AST node at the specified path or null if not found
   */
  getInfoForNavigation(
    filename: string,
    navigation: (string | number)[] | null,
    options: Partial<{
      traverseUpward: (node: AnvilUnknownNode | null) => boolean;
      traverseToSpannableNode: boolean;
    }> = {}
  ): AnvilUnknownNode | null {
    console.log("Getting info for navigation", filename, navigation, options);
    if (!navigation) {
      console.log("No navigation steps provided");
      return null;
    }

    const fileIndex = this.filenameToIndex[filename];
    if (fileIndex === undefined) {
      console.log("File not found in AST", filename);
      return null;
    }

    let pointers: AnvilUnknownNode[] = [];
    let current: AnvilUnknownNode | null = this.data[fileIndex].compilation_unit;

    console.log("Starting at compilation unit");
    for (const step of navigation) {
      if (current === undefined || current === null) {
        console.log("Current is undefined or null", current);
        return null;
      }

      pointers.push(current);

      if (typeof current !== 'object' && !Array.isArray(current)) {
        return null;
      }

      console.log("Stepping into", step);

      current = (current as any)[step] as any;
    }

    console.log("Final node", current);

    // Now current is the node at the navigation path
    // If traverseUpward is true, go up the tree until it returns false or we reach the root
    while ((options.traverseUpward ?? (() => false))(current) && pointers.length > 0) {
      current = pointers.pop() || null;
    }

    if (options.traverseToSpannableNode && current) {
      while (current && !this.isSpannableNode(current)) {
        current = pointers.pop() || null;
      }
    }

    return current;
  }

  getCompilationUnit(filename: string): AnvilCompUnit | null {
    const fileIndex = this.filenameToIndex[filename];
    if (fileIndex === undefined) {
      return null;
    }
    return this.data[fileIndex].compilation_unit;
  }

  isSpannableNode(node: AnvilUnknownNode): node is AnvilSpannable {
    return node && typeof node.kind === 'string' && typeof node.span === 'object' && node.span;
  }

  isAstNode(node: AnvilUnknownNode): node is AnvilAstNode {
    return node && (node.kind === "ast_node" || node.kind === "expr_node");
  }

  isExprNode(node: AnvilUnknownNode): node is AnvilExpr {
    return node && node.kind === "expr";
  }

  isChannelClassNode(node: AnvilUnknownNode): node is AnvilChannelClass {
    return node && node.kind === "channel_class_def";
  }

  isMessageNode(node: AnvilUnknownNode): node is AnvilMessage {
    return node && node.kind === "message_def";
  }

  isTypeNode(node: AnvilUnknownNode): node is AnvilType {
    return node && node.kind === "type_def";
  }

  isMacroNode(node: AnvilUnknownNode): node is AnvilMacro {
    return node && node.kind === "macro_def";
  }

  isFuncNode(node: AnvilUnknownNode): node is AnvilFunc {
    return node && node.kind === "func_def";
  }

  isProcNode(node: AnvilUnknownNode): node is AnvilProc {
    return node && node.kind === "proc_def";
  }

  isRegisterNode(node: AnvilUnknownNode): node is AnvilRegister {
    return node && node.kind === "reg_def";
  }

  isEndpointNode(node: AnvilUnknownNode): node is AnvilEndpoint {
    return node && node.kind === "endpoint_def";
  }

  isChannelNode(node: AnvilUnknownNode): node is AnvilChannel {
    return node && node.kind === "channel_def";
  }

  private matchNavigation(
    navigation: AnvilCompUnitNav | null | undefined,
    pattern: (string | number | null)[]
  ): boolean {

    if (!navigation || navigation.length !== pattern.length) {
      return false;
    }
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === null) {
        continue; // Wildcard match
      }

      if (pattern[i] !== navigation[i]) {
        return false;
      }
    }
    return true;
  }

  private searchMatching(
    filename: string,
    navigation: AnvilCompUnitNav,
    condition: (node: AnvilUnknownNode) => boolean
  ): AnvilCompUnitNav | null {

    let node = this.getInfoForNavigation(filename, navigation);
    if (!node) {
      return null;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (condition(node[i])) {
          const copy = [...navigation];
          copy.push(i);
          return copy as AnvilCompUnitNav;
        }
        console.log("DEF Array not match for index", i, node[i]);
      }
    } else if (typeof node === 'object') {
      for (const key in node) {
        if (condition((node as any)[key])) {
          const copy = [...navigation];
          copy.push(key);
          return copy as AnvilCompUnitNav;
        }
        console.log("DEF Key not match for", key, (node as any)[key]);
      }
    }

    return null;
  }

  private searchFirstMatching(
    navigations: { filename: string | null, navigation: AnvilCompUnitNav }[],
    condition: (node: AnvilUnknownNode) => boolean
  ): { filename: string; navigation: AnvilCompUnitNav } | null {

    const filenames = Object.keys(this.filenameToIndex);
    let results: { filename: string; navigation: AnvilCompUnitNav }[] = [];

    for (const { filename, navigation } of navigations) {
      const targetFilenames = filename ? [filename] : filenames;
      for (const fname of targetFilenames) {
        const result = this.searchMatching(fname, navigation, condition);
        if (result) {
          return { filename: fname, navigation: result };
        }
        console.log("DEF search not match for", fname, navigation);
      }
    }

    return null;
  }


  navigateToDefinitionTree(filename: string, navigation: AnvilCompUnitNav): AnvilCompUnitNavWithFilename[] | null {
    // TODO: Implement full logic.
    // For now, we'll do basic examples:

    let definitionTree: AnvilCompUnitNavWithFilename[] = [];

    const expandTree = () => {
      if (definitionTree.length === 0) return;
      const tail = definitionTree[definitionTree.length - 1];
      if (!tail) return;
      const result = this.navigateToDefinitionTree(tail.filename, tail.navigation) ?? [];
      definitionTree.push(...result);
      return definitionTree[definitionTree.length - 1];
    }

    const pushAndExpandTree = (nav: AnvilCompUnitNavWithFilename) => {
      definitionTree.push(nav);
      return expandTree();
    }


    let node = this.getInfoForNavigation(filename, navigation);
    if (!node) {
      return null;
    }

    if (this.isExprNode(node)) {
      const expr = node;
      switch (expr.type) {
        case 'send':
        case 'recv':

          const pack = expr.send_pack || expr.recv_pack;
          if (!pack) {
            break; // Pack not found! This is invalid.
          }

          // Discovered endpoint
          const endpointName = pack.msg_spec.endpoint;
          const messageName = pack.msg_spec.msg;

          // Find the endpoint definition
          let endpDef = this.searchFirstMatching(
            [
              {filename: filename, navigation: ["procs", navigation[1] as number, "body", "data", "channels"]}, // scoped def
              {filename: filename, navigation: ["procs", navigation[1] as number, "args"]}, // same file def
              {filename: null, navigation: ["procs", navigation[1] as number, "args"]} // any file def
            ],
            (node) =>
              (this.isEndpointNode(node) && node.name === endpointName) ||
              (this.isChannelNode(node) && (
                node.endpoint_left === endpointName || node.endpoint_right === endpointName
              ))
          );

          if (!endpDef) {
            // Not found! Give up.
            break;
          }

          // Success! Now expand definitions from here
          const newDef = pushAndExpandTree(endpDef);
          if (!newDef) {
            break; // No subsequent definition found!
          }

          // See if we have expanded and obtained the actual channel class
          const channelClassIndex = this.matchNavigation(newDef.navigation, ['channel_classes', null]) ? newDef.navigation?.[1] as number ?? -1 : -1;
          if (channelClassIndex < 0) {
            break; // No valid channel class found!
          }

          const msgDefNav = this.searchMatching(newDef.filename, ['channel_classes', channelClassIndex, 'messages'], (node) => {
            return this.isMessageNode(node) && node.name === messageName;
          });

          if (!msgDefNav) {
            break; // No valid message found!
          }

          // Success! Now expand definitions and finalize here
          pushAndExpandTree({ filename: newDef.filename, navigation: msgDefNav });
      }
    }

    if (this.isEndpointNode(node) || this.isChannelNode(node)) {

      // Find the channel class definition
      const channelClassName = node.channel_class;
      const channelClassNav = this.searchFirstMatching(
        [
          { filename, navigation: ["procs", navigation[1] as number, "body", "data", "channels"] }, // scoped def
          { filename, navigation: ["channel_classes"] }, // same file def
          { filename: null, navigation: ["channel_classes"] } // any file def
        ],
        (node) =>
          (this.isChannelClassNode(node) && node.name === channelClassName) ||
          (this.isChannelNode(node) && node.name === channelClassName)
      );

      if (!channelClassNav) {
        return null; // No valid channel class found!
      }

      // Success! Now expand definitions from here
      pushAndExpandTree(channelClassNav);
    }

    return definitionTree;
  }

  lookupDefinitionForIdentifier(filename: string, identifier: string, line: number, col: number): AnvilCompUnitNavWithFilename[] {
    console.log("DEF_ID Looking up definition for identifier", identifier, "at", { filename, line, col });
    const validResults = this.identifierToTreeNavigation[identifier] || [];
    if (validResults.length === 0) {
      console.log("DEF_ID No valid results for identifier", identifier);
      return [];
    }

    // Get closest span
    const navigation = this.getNavigationToSpan(filename, { start: { line, col }, end: { line, col } });
    if (!navigation) {
      console.log("DEF_ID No navigation found for location", { filename, line, col });
      return [];
    }

    // Filter results to those in scope
    const inScopeResults = validResults.filter(res =>
      this.isNavigationInScopeOf(navigation, res.navigation)
    );

    if (inScopeResults.length === 0) {
      console.log("DEF_ID No in-scope results for identifier", identifier, "at", { filename, line, col });
      return [];
    }

    // Prefer results in the same file
    let preferredResults = inScopeResults.filter(res => res.filename === filename);
    if (preferredResults.length === 0) {
      preferredResults = inScopeResults;
    }

    // Sort by span position (deepest first, then earliest)
    preferredResults.sort((a, b) => {
      if (a.navigation.length !== b.navigation.length) {
        return b.navigation.length - a.navigation.length;
      }

      if (a.span.start.line !== b.span.start.line) {
        return a.span.start.line - b.span.start.line;
      }

      return a.span.start.col - b.span.start.col;
    });

    console.log("DEF_ID Found", preferredResults.length, "preferred results for identifier", identifier, preferredResults);

    // Pick the first result as the most relevant
    const chosen = preferredResults[0];
    if (!chosen) {
      return [];
    }

    // Now navigate to its definition tree
    const defTree = this.navigateToDefinitionTree(chosen.filename, chosen.navigation);
    if (!defTree) {
      console.log("DEF_ID No definition tree found for", chosen);
      return [];
    }

    console.log("DEF_ID Found definition tree for", chosen);
    defTree.unshift({ filename: chosen.filename, navigation: chosen.navigation });
    return defTree;
  }

  getIdentifierNavigation(identifier: string): AnvilCompUnitNavWithFilename[] {
    return [...(this.identifierToTreeNavigation[identifier] || [])];
  }

  getIdentifiers(): string[] {
    return Object.keys(this.identifierToTreeNavigation);
  }

  private isSpanBefore(a: AnvilSpan, b: AnvilSpan): boolean {
    if (a.end.line < b.start.line) return true;
    if (a.end.line === b.start.line && a.end.col < b.start.col) return true;
    return false;
  }

  private isSpanAfter(a: AnvilSpan, b: AnvilSpan): boolean {
    if (a.start.line > b.end.line) return true;
    if (a.start.line === b.end.line && a.start.col > b.end.col) return true;
    return false;
  }

  private isNavigationInScopeOf(navigation: AnvilCompUnitNav, scope: AnvilCompUnitNav): boolean {
    if (scope.length <= 2) {
      return true; // Global scope
    }
    if (navigation.length < scope.length) {
      return false; // Navigation is shallower than scope
    }

    for (let i = 0; i < scope.length; i++) {
      if (navigation[i] !== scope[i]) {
        // Diverged! Verify if this condition is still in scope

        if (navigation[i] === 'rhs' && scope[i] === 'lhs') {
          // 'rhs' is within 'lhs' scope
          return true;
        }

        if (navigation[i] === 'body' && i === 2) {
          // 'body' may access other top-level items
          return true;
        }

        console.log("Out of scope at item", i + 1, " of nav:", navigation, "scope:", scope);
        return false;
      }
    }

    return true; // If we made it this far, it's in scope
  }

  private traverseAST(filename: string, node: unknown, path: (string | number)[] = []) {
    if (node === null || node === undefined) {
      return;
    }

    if (typeof (node as any).span === 'object' && (node as any).span) {
      const arr = this.spanToTreeNavigation[filename] || []
      this.spanToTreeNavigation[filename] = arr;

      arr.push({ span: (node as any).span, navigation: path as AnvilCompUnitNav });
    }

    if (Array.isArray(node)) {
      node.forEach((elem, index) => this.traverseAST(filename, elem, [...path, index]));
      return;
    }

    if (typeof node === 'object') {
      // If it's an AST node (type: "ast_node" or "expr_node"), flatten the "data" field

      if (node && this.isAstNode(node)) {
        const data = node.data;
        if (typeof data === 'object' && data) {
          delete node.data;
          for (const key in data) {
            // Copy all fields from data to node
            (node as any)[key] = (data as any)[key];
          }
        }
      }

      for (const key in node) {
        const value = (node as any)[key];

        // Only traverse into objects and arrays, skip primitives and null
        if (typeof value === 'object' && value !== null) {
          this.traverseAST(filename, value, [...path, key]);
        }
      }
    }

    if (typeof node === 'object') {
      // if it has an identifier, map it
      const identifiers = [];

      const anyNode = node as any;
      if (anyNode.name) {
        identifiers.push(anyNode.name);
      }
      if (anyNode.id) {
        identifiers.push(anyNode.identifier);
      }
      if (anyNode.ids) {
        identifiers.push(...anyNode.ids);
      }

      for (const id of identifiers) {
        if (typeof id === 'string') {
          const arr = this.identifierToTreeNavigation[id] || [];
          this.identifierToTreeNavigation[id] = arr;

          arr.push({ filename, span: anyNode.span, navigation: path as AnvilCompUnitNav });

          console.log("Mapped identifier", id, "to", { filename, navigation: path });
        }
      }
    }
  }

  toJSON(): string {
    return JSON.stringify(this.data, null, 2);
  }
}