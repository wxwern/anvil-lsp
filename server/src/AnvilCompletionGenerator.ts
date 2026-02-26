import {CompletionItem, CompletionItemKind} from "vscode-languageserver";
import {AnvilAst, AnvilAstNode} from "./AnvilAst";
import {AnvilDescriptionGenerator} from "./AnvilDescriptionGenerator";
import {AnvilDocument} from "./AnvilDocument";
import z from "zod";

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

  public static readonly TRIGGER_PREFIXES = ['.', ',', '*', '(', '[', ';', ' '];

  public static getCompletions(prefix: string, document: AnvilDocument): AnvilCompletionDetail[] {

    let completionItems: AnvilCompletionDetail[] = []
    let allowAnvilKeywords = true;

    const ast = document.anvilAst;


    // All identifiers from the AST.

    completionItems.push(...(ast?.getAll().map((loc) => {
      const node = ast.goTo(loc);
      if (!node) return null;

      const nodeKind = node.traverse("kind").resolveAs(z.string());
      const name = node?.traverse("name").resolveAs(z.string());

      let lspKind: CompletionItemKind = CompletionItemKind.Text;
      let hint: string | undefined = undefined;

      if (!name) return null;

      switch (nodeKind) {
        case 'expr': {
          lspKind = CompletionItemKind.Variable;
          break;
        }
        case 'reg_def': {
          lspKind = CompletionItemKind.Variable;
          hint = `(register)`;
          break;
        }
        case 'channel_class_def': {
          lspKind = CompletionItemKind.Class;
          hint = `(channel)`;
          break;
        }
        case 'struct_def': {
          lspKind = CompletionItemKind.Struct;
          hint = `(struct)`;
          break;
        }
        case 'func_def': {
          lspKind = CompletionItemKind.Function;
          hint = `(function)`;
          break;
        }
        case 'proc_def': {
          lspKind = CompletionItemKind.Module;
          hint = `(process)`;
          break;
        }
        case 'macro_def': {
          lspKind = CompletionItemKind.Constant;
          hint = `(macro)`;
          break;
        }
        case 'endpoint_def': {
          lspKind = CompletionItemKind.Interface;
          hint = `(endpoint)`;
          break;
        }
        case 'message_def': {
          lspKind = CompletionItemKind.Method;
          hint = `(message)`;
          break;
        }
      }

      return new AnvilCompletionDetail(
        name,
        lspKind,
        hint || '',
        () => AnvilDescriptionGenerator.describeNode(node, document)
      );
    }).filter(c => c).map(c => c!) ?? []));


    // All Anvil keywords and operators.

    if (allowAnvilKeywords) {
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
    }

    return completionItems;
  }
}
