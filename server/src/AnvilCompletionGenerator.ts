import {CompletionItem, CompletionItemKind, Position} from "vscode-languageserver";
import {AnvilAstNode} from "./AnvilAst";
import {AnvilDescriptionGenerator} from "./AnvilDescriptionGenerator";
import {AnvilDocument} from "./AnvilDocument";

export class AnvilCompletionDetail {
  constructor(
    public readonly label: string,
    public readonly lspKind: CompletionItemKind,
    public readonly hint: string,
    private detailsFunc: () => Promise<string>
  ) { }

  public async details(): Promise<string> {
    return this.detailsFunc();
  }

  public lspCompletionItem(): CompletionItem {
    return {
      label: this.label,
      kind: this.lspKind,
      data: this,
      detail: this.hint
    };
  }
}

export class AnvilCompletionGenerator {

  public static readonly TRIGGER_CHARS = ['.', ',', '*', '{', '(', '[', ';', '=', ' '];

  public static readonly SPACER_REGEX_GROUP = "(^|[\\s\\(\\[{])";
  public static readonly IDENTIFIER_REGEX_GROUP = "([a-zA-Z_][a-zA-Z0-9_]*)";


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
    const registerCompletions = this.checkReadRegisterHeuristics(position, document);
    if (registerCompletions) {
      return registerCompletions;
    }

    const sendRecvCompletions = this.checkSendRecvHeuristics(position, document);
    if (sendRecvCompletions) {
      return sendRecvCompletions;
    }


    // All identifiers from the AST.
    const ast = document.anvilAst;
    let completionItems: AnvilCompletionDetail[] = [];
    completionItems.push(...(ast?.getAll().flatMap((loc) => {
      const node = ast.goTo(loc);
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
          lspKind,
          hint || '',
          () => AnvilDescriptionGenerator.describeNode(node, document)
        ));
      }

      return list;
    }).filter(c => c).map(c => c!) ?? []));


    // All Anvil keywords and operators.
    const populateKeywords = (labels: string[], hint: string, kind?: CompletionItemKind) => {
      completionItems.push(...labels.map((label) => {
        return new AnvilCompletionDetail(
          label,
          kind || CompletionItemKind.Keyword,
          hint,
          async () => `Anvil built-in keyword \`${label}\` (${hint})`
        );
      }));
    };

    populateKeywords([
      'left', 'right', 'extern',
      'shared', 'assigned by', 'import', 'generate', 'generate_seq',
    ], '(modifier)');

    populateKeywords([
      'logic', 'int', 'dyn',
    ], '(type)');

    populateKeywords([
      'struct', 'enum', 'proc', 'spawn', 'type', 'func', 'const', 'reg', 'chan',
    ], '(declaration)');

    populateKeywords([
      'call', 'loop', 'recursive', 'if', 'else', 'try', 'recurse', 'recv', 'send',
      'dprint', 'dfinish', 'set', 'cycle', 'sync',  'match', 'put',  'ready', 'in',
      'probe',
    ], '(control)');

    populateKeywords(['with'], '(other)');
    populateKeywords(['let'], '(other)');

    completionItems.push(...[
      ['>>', 'wait', 'wait for evaluation of lhs before evaluating rhs'],
      [':=', 'assign', 'assign rhs value to lhs'],
      [';', 'join', 'evaluate lhs and rhs simulataneously'],
    ].map(([label, hint, detail]) => {
      let kind: CompletionItemKind = CompletionItemKind.Operator;
      return new AnvilCompletionDetail(
        label,
        kind,
        '(' + hint + ')',
        async () => `Anvil built-in operator \`${label}\` (${hint}) - ${detail}`
      );
    }));

    return completionItems;
  }




  private static checkReadRegisterHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at: *register_name
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
      CompletionItemKind.Variable,
      '(register)',
      () => AnvilDescriptionGenerator.describeNode(r, document)
    ));
  }



  private static checkSendRecvHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at: send/recv endpoint_name.message_name
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
        CompletionItemKind.Interface,
        '(endpoint)',
        () => AnvilDescriptionGenerator.describeNode(e, document)
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
      CompletionItemKind.Method,
      `${isSend ? 'send' : 'recv'} (message)`,
      () => AnvilDescriptionGenerator.describeNode(m, document)
    ));
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

}
