import {CompletionItem, CompletionItemKind, InsertTextFormat, Position} from "vscode-languageserver";
import {AnvilAstNode, AnvilAstNodePath} from "./AnvilAst";
import {AnvilDocument} from "./AnvilDocument";

export class AnvilCompletionDetail {
  constructor(
    public label: string,
    public insertText: string = label,
    public lspKind: CompletionItemKind,
    public hint: string,
    private documentation: { node?: AnvilAstNode, desc?: string } = {},
  ) { }

  private get isSnippet() {
    return this.insertText != this.label;
  }

  public lspCompletionItem(options?: { allowOOOSnippet?: boolean }): CompletionItem {
    const outOfOrder = options?.allowOOOSnippet ?? false;
    let insertText = this.insertText;

    if (this.isSnippet && !outOfOrder) {
      const re = /^(.+)\$\d+/g;
      const match = re.exec(this.insertText);
      if (match) {
        insertText = match[1];
      }
    }

    const d = this.documentation;

    return {
      label: this.label,
      kind: this.lspKind,
      data: "node" in d ? { filepath: d.node?.filepath, nodepath: d.node?.nodepath, desc: d.desc } : d,
      detail: this.hint,
      insertText: insertText,
      insertTextFormat: this.isSnippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
    };
  }
}

export class AnvilCompletionGenerator {

  public static readonly TRIGGER_CHARS = ['.', ',', '*', '{', '(', '[', ':', ';', '=', '@', ' '];

  public static readonly SPACER_REGEX_GROUP = "(^|[\\s\\(\\[{])";
  public static readonly IDENTIFIER_REGEX_GROUP = "([a-zA-Z_][a-zA-Z0-9_]*)";
  public static readonly TYPEDEF_REGEX_GROUP = "([a-zA-Z0-9_<>\\(\\)\\[\\]]+)";
  public static readonly LIFETIME_IDENTIFIER_REGEX_GROUP = "(#[~0-9]+|[a-zA-Z_][a-zA-Z0-9_]*[+0-9]*)";


  private static getPrefixAtPosition(position: Position, document: AnvilDocument, options?: { fast?: boolean }): string {
    const prefix = document.textDocument.getText({
      start: {line: (options?.fast ?? true) ? position.line : 0, character: 0},
      end: position
    });

    const lastNChars = 20;
    const logSample = prefix.slice(-lastNChars);
    console.log(`Prefix at position ${position.line}:${position.character} is: "${logSample.length < lastNChars ? logSample : '...' + logSample}"`);

    return prefix;
  }




  public static getCompletions(position: Position, document: AnvilDocument): AnvilCompletionDetail[] {

    // Check for special syntax heuristics first and return early for any matches.
    const readRegCompletions = this.checkReadRegisterHeuristics(position, document);
    if (readRegCompletions !== null) {
      return readRegCompletions;
    }

    const writeRegCompletions = this.checkWriteRegisterHeuristics(position, document);
    if (writeRegCompletions !== null) {
      return writeRegCompletions;
    }

    const sendRecvCompletions = this.checkSendRecvHeuristics(position, document);
    if (sendRecvCompletions !== null) {
      return sendRecvCompletions;
    }

    const timingAnnotCompletions = this.checkTimingAnnotHeuristics(position, document);
    if (timingAnnotCompletions !== null) {
      return timingAnnotCompletions;
    }

    const spawnCompletions = this.checkSpawnHeuristics(position, document);
    if (spawnCompletions !== null) {
      return spawnCompletions;
    }

    const typedefCompletions = this.checkTypedefHeuristics(position, document);
    if (typedefCompletions !== null) {
      return typedefCompletions;
    }

    // All identifiers from the AST.
    let completionItems: AnvilCompletionDetail[] = [];
    completionItems.push(...this.getAllEntries(this.getAllNodes(position, document)))

    // All Anvil keywords and operators.
    completionItems.push(...this.getAnvilBuiltinCompletions());

    return completionItems;
  }




  private static checkReadRegisterHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at: "*register_name"
    const regex = new RegExp(`${this.SPACER_REGEX_GROUP}\\*${this.IDENTIFIER_REGEX_GROUP}?$`, "g");
    console.log('Checking register completion heuristic with regex:', regex);
    const match = regex.exec(prefix);

    if (!match) {
      console.log('Register completion heuristic did not match.');
      return null;
    }

    console.log('Register completion heuristic matched!');
    const regPartialNamePrefix = match[2] || '';
    const ast = document.anvilAst;
    if (!ast) return null;

    // Locate registers in the closest proc scope, and filter by prefix.
    const regs = ast.goToClosest(
      document.filepath, position.line, position.character,
      n => n.kind === 'proc_def'
    )?.traverse("body", "regs").children;

    if (!regs) return null;

    const matchingRegs = regs.filter(r => r.name?.startsWith(regPartialNamePrefix));

    return matchingRegs.map(r => new AnvilCompletionDetail(
      r.name!,
      r.name!,
      CompletionItemKind.Variable,
      '(register)',
      { node: r }
    ));
  }





  private static checkWriteRegisterHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at: "set register_name :=" excluding the := operator.
    const regex = new RegExp(`${this.SPACER_REGEX_GROUP}set\\s+${this.IDENTIFIER_REGEX_GROUP}?$`, "g");
    console.log('Checking write register completion heuristic with regex:', regex);
    const match = regex.exec(prefix);

    if (!match) {
      console.log('Write register completion heuristic did not match.');
      return null;
    }

    console.log('Write register completion heuristic matched!');
    const regPartialNamePrefix = match[2] || '';
    const ast = document.anvilAst;
    if (!ast) return null;

    // Locate registers in the closest proc scope, and filter by prefix.
    const regs = ast.goToClosest(
      document.filepath, position.line, position.character,
      n => n.kind === 'proc_def'
    )?.traverse("body", "regs").children;

    if (!regs) return null;

    const matchingRegs = regs.filter(r => r.name?.startsWith(regPartialNamePrefix));

    return matchingRegs.map(r => new AnvilCompletionDetail(
      r.name!,
      r.name! + "$1 := $0",
      CompletionItemKind.Variable,
      '(register)',
      { node: r }
    ));
  }





  private static checkSendRecvHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at: "send/recv endpoint_name.message_name(" excluding the trailing "("
    const regex = new RegExp(`${this.SPACER_REGEX_GROUP}(send|recv)\\s+(${this.IDENTIFIER_REGEX_GROUP}(\\.(${this.IDENTIFIER_REGEX_GROUP})?)?)?$`, "g");
    console.log('Checking send/recv completion heuristic with regex:', regex);
    const match = regex.exec(prefix);
    if (!match) {
      console.log('Send/recv completion heuristic did not match.');
      return null;
    }

    console.log('Send/recv completion heuristic matched!');
    console.log(match);
    const isSend = match[2] === 'send';

    const endpointPartialNamePrefix = match[4] || '';
    const hasDot = !!match[5];
    const messagePartialNamePrefix = match[6] || '';

    console.log(`Parsed < | isSend: ${isSend} | "${endpointPartialNamePrefix}" | dot: ${hasDot} | "${messagePartialNamePrefix}" >`);

    const ast = document.anvilAst;
    if (!ast) return null;

    // The endpoint is either a local endpoint def or a local channel def

    // Attempt: endpoint_def search
    // Locate endpoints in the closest proc scope, and filter by prefix.
    const endpoints = ast.goToClosest(
      document.filepath, position.line, position.character,
      n => n.kind === 'proc_def'
    )?.traverse("args").children;

    const matchingEndpoints = endpoints?.filter(e => e.name?.startsWith(endpointPartialNamePrefix)) || [];

    // Attempt: channel_def search
    const channels = ast.goToClosest(
      document.filepath, position.line, position.character,
      n => n.kind === 'proc_def'
    )?.traverse("body", "channels").children

    const matchingChannels = channels
      ?.filter(c => c.names.find(n => n.startsWith(endpointPartialNamePrefix)))
      || [];

    const endpointCandidates = [...matchingEndpoints, ...matchingChannels];

    console.log(`Found ${endpointCandidates.length} endpoint candidates for prefix "${endpointPartialNamePrefix}"`);

    if (!messagePartialNamePrefix && !hasDot) {
      // If we haven't completed the endpoint, return endpoints.
      return endpointCandidates.flatMap(e => e.names.map(n => new AnvilCompletionDetail(
        n,
        n + '.',
        CompletionItemKind.Interface,
        '(endpoint)',
        { node: e }
      )));
    }

    // We have an endpoint now!
    const selectedEndpointName = endpointPartialNamePrefix;

    let messageCompletions: AnvilAstNode[] = [];
    for (const endpointCandidate of endpointCandidates) {
      const channelClassDef = endpointCandidate
        .definitions
        .map(d => ast.goTo(d))
        .find(n => n?.kind === 'channel_class_def');

      if (!channelClassDef) continue;

      let isOut = false;

      if (isSend) isOut = !isOut;

      if (endpointCandidate.kind === 'channel_def' &&
          endpointCandidate.down("endpoint_right")?.resolve() === selectedEndpointName) {
        isOut = !isOut;
      }

      const dir = isOut ? "out" : "in";

      const messages = channelClassDef.traverse("messages").children;
      const matchingMessages = messages
        .filter(m => m.down("dir").resolve() === dir)
        .filter(m => m.name?.startsWith(messagePartialNamePrefix));

      messageCompletions.push(...matchingMessages);
    }

    console.log(`Found ${messageCompletions.length} message candidates for prefix "${messagePartialNamePrefix}"`);

    return messageCompletions.map(m => new AnvilCompletionDetail(
      m.name!,
      m.name! + "($1)$0",
      CompletionItemKind.Method,
      `${isSend ? 'send' : 'recv'} (message)`,
      { node: m }
    ));
  }






  private static checkTimingAnnotHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is after an "@" symbol, indicating a timing annotation.
    const regex = new RegExp(
      `${this.SPACER_REGEX_GROUP}(left|right)\\s+${this.IDENTIFIER_REGEX_GROUP}\\s*:\\s*\\(.*?(@${this.LIFETIME_IDENTIFIER_REGEX_GROUP}?(\\)\\s+(@)?${this.LIFETIME_IDENTIFIER_REGEX_GROUP}?( *(-)? *(@)?${this.LIFETIME_IDENTIFIER_REGEX_GROUP}?)?)?)?$`,
      "g"
    );
    const match = regex.exec(prefix);
    console.log('Checking timing annotation completion heuristic with regex:', regex);
    if (!match) {
      console.log('Timing annotation completion heuristic did not match.');
      return null;
    }

    const identifier = match[2];
    const hasFirstAnnot = !!match[4];
    const firstAnnotPrefix = match[5] || '';
    const hasRangeStartAnnot = !!match[6];
    const hasRangeStartAtSign = !!match[7];
    const rangeStartAnnotPrefix = match[8] || '';
    const hasRangeEndAnnot = !!match[9];
    const hasRangeMidDash = !!match[10];
    const hasRangeEndAtSign = !!match[11];
    const rangeEndAnnotPrefix = match[12] || '';

    if (!hasFirstAnnot) {
      console.log('Timing annotation completion heuristic did not match (first annotation not yet detected).');
      return null;
    }

    console.log(`Parsed < | hasFirst: ${hasFirstAnnot} | "${firstAnnotPrefix}" | hasRangeStart: ${hasRangeStartAnnot} | "${rangeStartAnnotPrefix}" | hasRangeEnd: ${hasRangeEndAnnot} | "${rangeEndAnnotPrefix}" >`);
    console.log('Timing annotation completion heuristic matched!');

    let completionItems: AnvilCompletionDetail[] = [];

    const ast = document.anvilAst;
    if (!ast) return completionItems;

    const messageDefs = ast.goToClosest(
      document.filepath, position.line, position.character,
      n => n.kind === 'channel_class_def'
    )?.traverse("messages").children
    .filter(n => n.kind === 'message_def')
    .filter(n => n.name !== identifier) || [];


    if (!hasRangeStartAnnot) {
      // lifetime part
      completionItems.push(new AnvilCompletionDetail(
        '#N',
        '#$1)',
        CompletionItemKind.TypeParameter,
        '(fixed lifetime)',
        { desc: 'Valid for N cycles' }
      ));

      completionItems.push(...messageDefs.flatMap(m => [
        new AnvilCompletionDetail(
          m.name!,
          m.name! + '$1)',
          CompletionItemKind.TypeParameter,
          '(relative lifetime)',
          { node: m, desc: 'Valid for the same amount of time this endpoint is valid.' }
        ),
      ]));

    } else {
      if (hasRangeStartAnnot && !hasRangeStartAtSign) {
        return [];
      }

      if (hasRangeEndAnnot && (!hasRangeEndAtSign || !hasRangeMidDash)) {
        return [];
      }

      // synchronisation part
      completionItems.push(new AnvilCompletionDetail(
        '#N',
        '#$0',
        CompletionItemKind.TypeParameter,
        '(fixed sync)',
        { desc: 'Valid beginning after every N cycles from start\n(`kN for k >= 1`)' }
      ));

      completionItems.push(new AnvilCompletionDetail(
        '#M~N',
        '#$1~$0',
        CompletionItemKind.TypeParameter,
        '(fixed sync)',
        { desc: 'Valid beginning Mth cycle, and beginning every N cycles after (`M+kN for k >= 0`)' }
      ));

      completionItems.push(new AnvilCompletionDetail(
        'dyn',
        'dyn',
        CompletionItemKind.TypeParameter,
        '(dynamic sync)',
        { desc: 'Dynamically synchronised validity.' }
      ));

      completionItems.push(...messageDefs.flatMap(m => [
        new AnvilCompletionDetail(
          m.name!,
          m.name!,
          CompletionItemKind.TypeParameter,
          '(relative sync)',
          { node: m, desc: 'Valid starting when this endpoint is valid.' }
        ),
        new AnvilCompletionDetail(
          m.name! + "+N",
          m.name! + "+$0",
          CompletionItemKind.TypeParameter,
          '(relative sync)',
          { node: m, desc: 'Valid starting N cycles after this endpoint becomes valid.' }
        ),
      ]));
    }
    return completionItems;
  }




  private static checkTypedefHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at:
    // - "(reg/chan/left/right) typename : typedef"
    const regex = new RegExp(`^\\s*(reg|left|right|let)\\s+${this.IDENTIFIER_REGEX_GROUP}\\s*(:)?\\s*${this.TYPEDEF_REGEX_GROUP}?$`, "g");
    console.log('Checking typedef completion heuristic with regex:', regex);
    const match = regex.exec(prefix);

    if (!match) {
      console.log('Typedef completion heuristic did not match.');
      return null;
    }

    console.log('Typedef completion heuristic matched!');
    const keyword = match[1];
    const hasColon = !!match[3];
    const typedefPartialPrefix = match[4] || '';
    const typedefPartialNamePrefix = typedefPartialPrefix.split(/[<>\(\)\[\]]/g).slice(-1)[0] || '';
    const ast = document.anvilAst;

    if (!ast) return null;

    if (!hasColon) {
      console.log('Intentionally returning nothing (: not yet entered).');
      return [];
    }

    const allDefs = this.getAllNodes(
      position, document,
      { filter: n => !!(n.kind === "type_def" && n.names.find(n => n.startsWith(typedefPartialNamePrefix))) }
    ).filter(n => n.kind === 'type_def');

    const allResults = this.getAllEntries(allDefs)
    ;
    allResults.push(...this.getAnvilBuiltinCompletions('type'));

    if (keyword === 'left' || keyword === 'right') {
      // channel endpoint, add a ( in front if not already present
      if (!typedefPartialPrefix.trim().endsWith('(')) {
        allResults.forEach(r => r.insertText = '(' + r.insertText);
      }
    }

    if (prefix.endsWith(':')) {
      // add a space in front
      allResults.forEach(r => r.insertText = ' ' + r.insertText);
    }

    console.log(`Found ${allResults.length} typedef candidates for prefix "${typedefPartialNamePrefix}"`);
    return allResults;

  }


  private static checkSpawnHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at: "spawn proc_name(" excluding the trailing "("
    const regex = new RegExp(`${this.SPACER_REGEX_GROUP}spawn\\s+${this.TYPEDEF_REGEX_GROUP}?$`, "g");
    console.log('Checking spawn completion heuristic with regex:', regex);

    const match = regex.exec(prefix);
    if (!match) {
      console.log('Spawn completion heuristic did not match.');
      return null;
    }

    console.log('Spawn completion heuristic matched!');
    const procPartialNamePrefix = match[2] || '';
    const ast = document.anvilAst;
    if (!ast) return null;

    // Locate all proc defs in the document and filter by prefix.
    const procs = this.getAllNodes(
      position, document,
      { filter: n => !!(n.kind === "proc_def" && n.name?.startsWith(procPartialNamePrefix)) }
    );

    const results = procs.map(p => {
      const name = p.name!;
      const params = p.down("params")?.children.map(c => c.name).filter(n => !!n) || [];
      const endpoints = p.down("args")?.children.map(c => c.name).filter(n => !!n) || [];

      const paramFormat = params.length > 0
        ? '<' + params.map((p, i) => `\${${i + 1}:${p}}`).join(', ') + '>'
        : '';
      const endpointFormat = endpoints.length > 0
        ? '(' + endpoints.map((e, i) => `\${${i + 1 + params.length}:${e}}`).join(', ') + ')'
        : '()';

      return new AnvilCompletionDetail(
        name,
        name + paramFormat + endpointFormat,
        CompletionItemKind.Module,
        '(process)',
        { node: p }
      );
    });

    console.log(`Found ${results.length} proc candidates for prefix "${procPartialNamePrefix}"`);
    return results;
  }



  private static getAllNodes(
    position: Position, document: AnvilDocument,
    options?: {
      scoped?: boolean | string,
      filter?: (node: AnvilAstNode) => boolean,
      relnodepath?: AnvilAstNodePath
    }
  ): AnvilAstNode[] {

    const ast = document.anvilAst;
    const filter = options?.filter ?? (() => true);
    const scoped = options?.scoped ?? false;
    const scopeCond = typeof scoped === 'string'
      ? (n: AnvilAstNode) => n.kind === scoped
      : (n: AnvilAstNode) => true;
    const relnodepath = options?.relnodepath;

    if (!ast) return [];


    let nodeList: AnvilAstNode[] =  relnodepath
    ? (
      scoped
      ? Array.of(...(
          ast.goToClosest(document.filepath, position.line, position.character, scopeCond) ?? ast.goToRoot(document.filepath)
        )?.traverse(...relnodepath).children ?? [])
      : ast.getAllRoots().flatMap(n => n.traverse(...relnodepath).children)
    )
    : (
      scoped
      ? Array.of(...(
          ast.goToClosest(document.filepath, position.line, position.character, scopeCond) ?? ast.goToRoot(document.filepath)
        )?.getAllDescendants() ?? [])

      : ast.getAllLocatableNodes().map(l => ast.goTo(l)).filter(n => !!n)
    );


    return nodeList.filter(filter);
  }

  private static getAllEntries(nodes: AnvilAstNode[]) {
    return nodes.flatMap((node) => {
      if (!node) return null;

      const nodeKind = node.kind;

      let identifiers: string[] = [];
      identifiers.push(...node.names);

      let lspKind: CompletionItemKind = CompletionItemKind.Text;
      let hint: string | undefined = undefined;

      let list: AnvilCompletionDetail[] = [];

      for (const name of identifiers) {
        if (!name) return null;

        ({lspKind, hint} = AnvilCompletionGenerator.getPropsForNodeKind(nodeKind));

        list.push(new AnvilCompletionDetail(
          name,
          name,
          lspKind,
          hint || '',
          { node }
        ));
      }

      return list;
    })
    .filter(c => c)
    .map(c => c!) ?? [];
  }


  private static getPropsForNodeKind(nodeKind: AnvilAstNode['kind']): {lspKind: CompletionItemKind, hint?: string} {
    switch (nodeKind) {
      case 'expr': {
        return {
          lspKind: CompletionItemKind.Variable,
        };
      }
      case 'reg_def': {
        return {
          lspKind: CompletionItemKind.Variable,
          hint: `(register)`,
        };
      }
      case 'channel_class_def': {
        return {
          lspKind: CompletionItemKind.Class,
          hint: `(channel)`,
        };
      }
      case 'struct_def': {
        return {
          lspKind: CompletionItemKind.Struct,
          hint: `(struct)`,
        };
      }
      case 'func_def': {
        return {
          lspKind: CompletionItemKind.Function,
          hint: `(function)`,
        };
      }
      case 'proc_def': {
        return {
          lspKind: CompletionItemKind.Module,
          hint: `(process)`,
        };
      }
      case 'macro_def': {
        return {
          lspKind: CompletionItemKind.Constant,
          hint: `(macro)`,
        };
      }
      case 'endpoint_def': {
        return {
          lspKind: CompletionItemKind.Interface,
          hint: `(endpoint)`,
        };
      }
      case 'message_def': {
        return {
          lspKind: CompletionItemKind.Method,
          hint: `(message)`,
        };
      }
      default: {
        return {
          lspKind: CompletionItemKind.Text,
        };
      }
    }
  }

  private static getAnvilBuiltinCompletions(category?: string | null, filter?: string[]): AnvilCompletionDetail[] {
    let completionItems: AnvilCompletionDetail[] = [];
    const populateKeywords = (labels: string[], hint: string, type?: string, kind?: CompletionItemKind) => {
      completionItems.push(...labels.map((label) => {
        return new AnvilCompletionDetail(
          label,
          label,
          kind || CompletionItemKind.Keyword,
          '(' + hint + ')',
          { desc: `Anvil built-in ${hint} ${type ?? 'keyword'} \`${label}\`` }
        );
      }));
    };

    populateKeywords([
      'left', 'right', 'extern',
      'shared', 'assigned by', 'import', 'generate', 'generate_seq',
    ], 'modifier');

    populateKeywords([
      'logic', 'int',
    ], 'type');

    populateKeywords([
      'struct', 'enum', 'proc', 'spawn', 'type', 'func', 'const', 'reg', 'chan',
    ], 'declaration');

    populateKeywords([
      'call', 'loop', 'recursive', 'if', 'else', 'try', 'recurse', 'recv', 'send',
      'dprint', 'dfinish', 'set', 'cycle', 'sync',  'match', 'put',  'ready', 'in',
      'probe',
    ], 'control');

    populateKeywords(['with'], 'misc');
    populateKeywords(['let'], 'binding');

    populateKeywords(['@#', '@dyn', '~'], 'timing');

    completionItems.push(...[
      ['>>', 'wait', 'wait for evaluation of lhs before evaluating rhs'],
      [':=', 'assign', 'assign rhs value to lhs'],
      [';', 'join', 'evaluate lhs and rhs simulataneously'],
    ].map(([label, hint, detail]) => {
      let kind: CompletionItemKind = CompletionItemKind.Operator;
      return new AnvilCompletionDetail(
        label,
        label,
        kind,
        '(' + hint + ')',
        { desc: `Anvil built-in ${hint} operator \`${label}\`\n\n---\n\n${detail}` }
      );
    }));

    return completionItems
      .filter(c => !filter || filter.includes(c.label))
      .filter(c => !category || c.hint.includes(`(${category})`));
  };


}
