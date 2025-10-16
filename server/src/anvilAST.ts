type AnvilParam = {
  name: string;
  type: 'int' | 'type';
};

type AnvilParamValue =
  | { type: 'int'; value: number }
  | { type: 'type'; value: AnvilDataType };

type AnvilSpan = {
  start_line: number;
  start_cnum: number;
  end_line: number;
  end_cnum: number;
};

type AnvilEndpointDirection = 'left' | 'right';
type AnvilMessageDirection = 'in' | 'out';

type AnvilSyncMode =
  | { type: 'dynamic' }
  | { type: 'static'; init_offset: number; interval: number }
  | { type: 'dependent'; message: string; delay: number };

type AnvilMessage = {
  name: string;
  dir: AnvilMessageDirection;
  send_sync: AnvilSyncMode;
  recv_sync: AnvilSyncMode;
  signal_types: {
    dtype: AnvilDataType;
    lifetime:
    | { type: 'cycles'; value: number }
    | { type: 'message'; value: { endpoint: string; message: string } }
    | { type: 'eternal' };
  }[];
  span: AnvilSpan;
};

type AnvilChannelClass = {
  name: string;
  messages: AnvilMessage[];
  params: AnvilParam[];
  span: AnvilSpan;
};

type AnvilType = {
  name: string;
  body: AnvilDataType;
  params: AnvilParam[];
  span: AnvilSpan;
}

type AnvilMacro = {
  id: string;
  value: number;
  span: AnvilSpan;
}

type AnvilFunc = {
  name: string;
  args: string[];
  body: AnvilExprNode; // TODO
  span: AnvilSpan;
}

type AnvilFieldNode = {
  field: string;
  value: AnvilExprNode;
  span: AnvilSpan;
};

type AnvilFieldType = {
  name: string;
  type: AnvilDataType;
  span: AnvilSpan;
};

type AnvilDataType =
  | { type: 'logic' }
  | { type: 'array'; element_type: AnvilDataType; size: number | string }
  | { type: 'variant'; constructors: { name: string; type: AnvilDataType | null }[] }
  | { type: 'record'; fields: AnvilFieldType[] }
  | { type: 'tuple'; elements: AnvilDataType[] }
  | { type: 'opaque'; name: string }
  | { type: 'named'; name: string; params: AnvilParamValue[] };

type AnvilMessageSpecifier = {
  endpoint: string;
  message: string;
};

type AnvilPackType = {
  message_specifier: AnvilMessageSpecifier;
  data: AnvilExprNode;
};

type AnvilIndexType =
  | { type: 'single'; index: AnvilExprNode }
  | { type: 'range'; start: AnvilExprNode; end: AnvilExprNode };

type AnvilExprNode = {
  expression:
  | { type: 'literal'; literal: any } // TODO
  | { type: 'identifier'; name: string }
  | { type: 'call'; function_name: string; arguments: AnvilExprNode[] }
  | { type: 'assign'; lvalue: AnvilLValue; value: AnvilExprNode }
  | { type: 'binop'; operator: string; left: AnvilExprNode; right: AnvilExprNode[] }
  | { type: 'unop'; operator: string; operand: AnvilExprNode }
  | { type: 'tuple'; elements: AnvilExprNode[] }
  | { type: 'let'; identifiers: string[]; value: AnvilExprNode }
  | { type: 'join'; first: AnvilExprNode; second: AnvilExprNode }
  | { type: 'wait'; first: AnvilExprNode; second: AnvilExprNode }
  | { type: 'cycle'; cycles: number }
  | { type: 'sync'; identifier: string }
  | { type: 'if'; condition: AnvilExprNode; then: AnvilExprNode; else: AnvilExprNode }
  | { type: 'try_recv'; identifier: string; recv_pack: AnvilPackType; on_success: AnvilExprNode; on_failure: AnvilExprNode }
  | { type: 'try_send'; send_pack: AnvilPackType; on_success: AnvilExprNode; on_failure: AnvilExprNode }
  | { type: 'construct'; variant_type: string; constructor: string; value: AnvilExprNode | null }
  | { type: 'record'; record_type: string; fields: AnvilFieldNode[]; base: AnvilExprNode | null }
  | { type: 'index'; array: AnvilExprNode; index: AnvilIndexType }
  | { type: 'indirect'; expression: AnvilExprNode; field: string }
  | { type: 'concat'; elements: AnvilExprNode[] }
  | { type: 'read'; identifier: string }
  | { type: 'debug'; debug_op: any } // TODO debug_op
  | { type: 'send'; send_pack: AnvilPackType }
  | { type: 'recv'; recv_pack: AnvilPackType }
  | { type: 'shared_assign'; identifier: string; value: AnvilExprNode }
  | { type: 'recurse' }
  | { type: 'list'; elements: AnvilExprNode[] }
  | { type: 'ready'; message_specifier: { endpoint: string; message: string } }
  | { type: 'probe'; message_specifier: { endpoint: string; message: string } };
  span: AnvilSpan;
}

type AnvilLValue =
  | { type: 'reg'; name: string }
  | { type: 'indexed'; base: AnvilLValue; index: any } // TODO index
  | { type: 'indirected'; base: AnvilLValue; field: string };

type AnvilNativeProcBody = {
  type: 'native';
  content: {
    channels: {
      channel: {
        channel_class: string;
        channel_params: AnvilParamValue[];
        endpoint_left: string;
        endpoint_right: string;
        visibility: 'both_foreign' | 'left_foreign' | 'right_foreign';
      };
      span: AnvilSpan;
    }[];
    spawns: {
      spawn: {
        proc: string;
        params: string[];
        compile_params: any[];
      };
      span: AnvilSpan;
    }[];
    regs: {
      reg: {
        name: string;
        dtype: AnvilDataType;
        init: string | null;
      };
      span: AnvilSpan;
    }[];
    shared_vars: {
      shared_var: {
        ident: string;
        assigning_thread: number;
        shared_lifetime:
        | { type: 'cycles'; value: number }
        | { type: 'message'; value: { endpoint: string; message: string } }
        | { type: 'eternal' };
      };
      span: AnvilSpan;
    }[];
    threads: AnvilExprNode[];
  };
}

type AnvilExternProcBody = {
  type: 'extern';
  module_name: string;
  content: {
    named_ports: { port_name: string; signal_name: string }[];
    msg_ports: {
      message_specifier: { endpoint: string; message: string };
      data_port: string | null;
      valid_port: string | null;
      ack_port: string | null;
    }[];
  };
}

type AnvilProc = {
  name: string;
  args: {
    endpoint: {
      name: string;
      channel_class: string;
      channel_params: AnvilParamValue[];
      direction: AnvilEndpointDirection;
      foreign: boolean;
      opposite_endpoint: string | null;
    };
    span: AnvilSpan;
  }[];
  body: AnvilNativeProcBody | AnvilExternProcBody;
  params: AnvilParam[];
}

export type AnvilCompilationUnitNavigation = (string | number)[];

export type AnvilCompilationUnit = {
  file_name: string;
  channel_classes: AnvilChannelClass[];
  type_defs: AnvilType[];
  macro_defs: AnvilMacro[];
  func_defs: AnvilFunc[];
  proc_defs: AnvilProc[];
  imports: {
    file_name: string;
    is_extern: boolean;
    span: AnvilSpan;
  }[];
};

export type AnvilASTOutput = {
  file_name: string;
  compilation_unit: AnvilCompilationUnit;
};

export class AnvilAST {
  private data: AnvilASTOutput[];
  private filenameToIndex: { [filename: string]: number } = {};

  private spanToTreeNavigation: {
    [filename: string]: {
      span: AnvilSpan;
      navigation: (string | number)[];
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
        if (a.span.start_line !== b.span.start_line) {
          return a.span.start_line - b.span.start_line;
        }
        return a.span.start_cnum - b.span.start_cnum;
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
  getNavigationToSpan(filename: string, span: AnvilSpan): AnvilCompilationUnitNavigation | null {
    let bestMatch: {
      span: AnvilSpan;
      navigation: AnvilCompilationUnitNavigation;
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

        const bestSize = (bestSpan.end_line - bestSpan.start_line) * 1000 + (bestSpan.end_cnum - bestSpan.start_cnum);
        const entrySize = (entrySpan.end_line - entrySpan.start_line) * 1000 + (entrySpan.end_cnum - entrySpan.start_cnum);

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
  getNavigationToLocation(filename: string, line: number, cnum: number): AnvilCompilationUnitNavigation | null {
    return this.getNavigationToSpan(filename, {
      start_line: line,
      start_cnum: cnum,
      end_line: line,
      end_cnum: cnum,
    });
  }

  /**
   * Get the AST node at a specific navigation path.
   * @param navigation The navigation path as an array of steps
   * @param traverseUpward A function that determines whether to traverse upward in the AST. Useful for getting out of nested structures.
   * @returns The AST node at the specified path or null if not found
   */
  getInfoForNavigation(
    filename: string,
    navigation: (string | number)[] | null,
    traverseUpward: (node: any) => boolean = () => false
  ): any | null {
    if (!navigation) {
      return null;
    }

    const fileIndex = this.filenameToIndex[filename];
    if (fileIndex === undefined) {
      return null;
    }

    let pointers: any[] = [];
    let current: any = this.data[fileIndex].compilation_unit;

    for (const step of navigation) {
      if (current === undefined || current === null) {
        return null;
      }
      pointers.push(current);
      current = current[step];
    }

    // Now current is the node at the navigation path
    // If traverseUpward is true, go up the tree until it returns false or we reach the root
    while (traverseUpward(current) && pointers.length > 0) {
      current = pointers.pop();
    }

    return current;
  }

  getCompilationUnit(filename: string): AnvilCompilationUnit | null {
    const fileIndex = this.filenameToIndex[filename];
    if (fileIndex === undefined) {
      return null;
    }
    return this.data[fileIndex].compilation_unit;
  }

  isExprNode(node: unknown): node is AnvilExprNode {
    return typeof node === 'object' && node !== null && (node as any).expression && (node as any).span;
  }

  isChannelNav(filename: string, navigation: AnvilCompilationUnitNavigation): AnvilChannelClass | undefined {
    if (this.matchNavigation(navigation, ['channel_classes', null])) {
      return this.getInfoForNavigation(filename, navigation) as AnvilChannelClass;
    }
    return undefined;
  }

  isMessageNav(filename: string, navigation: AnvilCompilationUnitNavigation): AnvilMessage | undefined {
    if (this.matchNavigation(navigation, ['channel_classes', null, 'messages', null])) {
      return this.getInfoForNavigation(filename, navigation) as AnvilMessage;
    }
    return undefined;
  }

  isFieldNav(filename: string, navigation: AnvilCompilationUnitNavigation): AnvilFieldNode | undefined {
    if (this.matchNavigation(navigation, ['channel_classes', null, 'fields', null])) {
      return this.getInfoForNavigation(filename, navigation) as AnvilFieldNode;
    }
    return undefined;
  }

  isEndpointNav(filename: string, navigation: AnvilCompilationUnitNavigation): AnvilProc['args'][0]['endpoint'] | undefined {
    if (this.matchNavigation(navigation, ['proc_defs', null, 'args', null])) {
      return this.getInfoForNavigation(filename, navigation) as AnvilProc['args'][0]['endpoint'];
    }
    return undefined;
  }

  isTypeNav(filename: string, navigation: AnvilCompilationUnitNavigation): AnvilType | undefined {
    if (this.matchNavigation(navigation, ['type_defs', null])) {
      return this.getInfoForNavigation(filename, navigation) as AnvilType;
    }
    return undefined;
  }

  isFuncNav(filename: string, navigation: AnvilCompilationUnitNavigation): AnvilFunc | undefined {
    if (this.matchNavigation(navigation, ['func_defs', null])) {
      return this.getInfoForNavigation(filename, navigation) as AnvilFunc;
    }
    return undefined;
  }

  isProcNav(filename: string, navigation: AnvilCompilationUnitNavigation): AnvilProc | undefined {
    if (this.matchNavigation(navigation, ['proc_defs', null])) {
      return this.getInfoForNavigation(filename, navigation) as AnvilProc;
    }
    return undefined;
  }

  isMacroNav(filename: string, navigation: AnvilCompilationUnitNavigation): AnvilMacro | undefined {
    if (this.matchNavigation(navigation, ['macro_defs', null])) {
      return this.getInfoForNavigation(filename, navigation) as AnvilMacro;
    }
    return undefined;
  }

  private matchNavigation(
    navigation: AnvilCompilationUnitNavigation | null | undefined,
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

  navigateToDefinitionTree(filename: string, navigation: AnvilCompilationUnitNavigation): AnvilCompilationUnitNavigation[] | null {
    // TODO: Implement full logic.
    // For now, we'll do basic examples:

    let definitionTree: AnvilCompilationUnitNavigation[] = [];

    const expandTree = () => {
      if (definitionTree.length === 0) return;
      const result = this.navigateToDefinitionTree(filename, definitionTree[definitionTree.length - 1]) ?? [];
      definitionTree.push(...result);
      return definitionTree[definitionTree.length - 1];
    }

    const pushAndExpandTree = (nav: AnvilCompilationUnitNavigation) => {
      definitionTree.push(nav);
      return expandTree();
    }


    const node = this.getInfoForNavigation(filename, navigation);
    if (!node) {
      return null;
    }

    if (this.isExprNode(node)) {
      const expr = node.expression;

      switch (expr.type) {
        case 'send':
        case 'recv':

          const pack =
            expr.type === 'send' ? expr.send_pack :
              expr.type === 'recv' ? expr.recv_pack :
                null;

          if (!pack) {
            return null; // Pack not found! This is invalid.
          }

          const endpointName = pack.message_specifier.endpoint;
          const messageName = pack.message_specifier.message;

          console.log(`Navigating to definition of message '${messageName}' on endpoint '${endpointName}'`);

          // Find the endpoint definition in the proc args
          const procEndpointNodeIndex = this.getCompilationUnit(filename)
            ?.proc_defs[navigation[1] as number]
            ?.args
            .findIndex(arg => arg.endpoint.name === endpointName)
            ?? -1;

          let newNavigationRoot;

          if (procEndpointNodeIndex < 0) {
            return null; // Endpoint not found! This is invalid.
          }

          console.log(`Found endpoint definition at index ${procEndpointNodeIndex}`);
          newNavigationRoot = pushAndExpandTree([...navigation.slice(0, 2), 'args', procEndpointNodeIndex]);

          const channelClassIndex = this.matchNavigation(newNavigationRoot, ['channel_classes', null]) ? newNavigationRoot?.[1] as number ?? -1 : -1;

          // Find the message definition in the channel class
          const messageIndex = this.getCompilationUnit(filename)
            ?.channel_classes[channelClassIndex]
            ?.messages
            .findIndex(msg => msg.name === messageName)
            ?? -1;

          if (messageIndex >= 0) {
            console.log(`Found message definition at index ${messageIndex}`);
            pushAndExpandTree(['channel_classes', channelClassIndex, 'messages', messageIndex]);
          }
      }
    }

    if (this.isEndpointNav(node, navigation)) {
      // Find the channel class definition
      const channelClassName = this.getInfoForNavigation(filename, [...navigation.slice(0, 4), 'endpoint', 'channel_class']) as string;
      const channelClassIndex = this.getCompilationUnit(filename)
        ?.channel_classes
        .findIndex(cc => cc.name === channelClassName)
        ?? -1;

      if (channelClassIndex >= 0) {
        console.log(`Found channel class definition at index ${channelClassIndex}`);
        definitionTree.push(['channel_classes', channelClassIndex]);
        expandTree();
      }
    }

    return definitionTree;
  }

  private isSpanBefore(a: AnvilSpan, b: AnvilSpan): boolean {
    if (a.end_line < b.start_line) return true;
    if (a.end_line === b.start_line && a.end_cnum < b.start_cnum) return true;
    return false;
  }

  private isSpanAfter(a: AnvilSpan, b: AnvilSpan): boolean {
    if (a.start_line > b.end_line) return true;
    if (a.start_line === b.end_line && a.start_cnum > b.end_cnum) return true;
    return false;
  }

  private traverseAST(filename: string, node: unknown, path: (string | number)[] = []) {
    if (typeof (node as any).span === 'object' && (node as any).span) {
      const arr = this.spanToTreeNavigation[filename] || []
      this.spanToTreeNavigation[filename] = arr;

      arr.push({ span: (node as any).span, navigation: path });
    }

    if (Array.isArray(node)) {
      node.forEach((elem, index) => this.traverseAST(filename, elem, [...path, index]));
      return;
    }

    if (typeof node === 'object') {
      for (const key in node) {
        const value = (node as any)[key];

        // Only traverse into objects and arrays, skip primitives and null
        if (typeof value === 'object' && value !== null) {
          this.traverseAST(filename, value, [...path, key]);
        }
      }
      return;
    }
  }

  toJSON(): string {
    return JSON.stringify(this.data, null, 2);
  }
}