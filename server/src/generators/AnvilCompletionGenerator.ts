import z from "zod";
import { CompletionItem, CompletionItemKind, InsertTextFormat, Position} from "vscode-languageserver";
import { AnvilAstNode, AnvilAstNodePath } from "../core/ast/AnvilAst";
import { AnvilDocument } from "../core/AnvilDocument";
import { AnvilChannelClassSchema, AnvilProcSchema, AnvilTypeSchema } from "../core/ast/schema";
import { completionInfo } from "../info/parsed";

export class AnvilCompletionDetail {
  private constructor(
    public label: string,
    public insertText: string = label,
    public lspKind: CompletionItemKind,
    public hint: string,
    private documentation: { node?: AnvilAstNode, desc?: string } = {},
    /** Whether this item originates from the built-in keyword/operator table. */
    public readonly source: 'builtinKeyword' | 'astNode' = 'astNode',
  ) { }

  public static create(label: string, insertText: string, lspKind: CompletionItemKind, hint: string, documentation?: { node?: AnvilAstNode, desc?: string }, source: 'builtinKeyword' | 'astNode' = 'astNode') {
    return new AnvilCompletionDetail(label, insertText, lspKind, `(${hint})`, documentation, source);
  }

  public static fromKeyword(keyword: string, category?: string | null, scopePrefixData?: string): AnvilCompletionDetail[] {
    const entry = completionInfo.getKeywordMetadata(keyword);
    let list: AnvilCompletionDetail[] = [];
    for (const variant of entry?.variants ?? []) {
      if (category && variant.category !== category) continue;

      const label = keyword;
      const insertText = variant.snippet ?? keyword;
      const lspKind = (CompletionItemKind as any)[variant.lspKind] ?? CompletionItemKind.Keyword;
      const hint = variant.hint;
      const desc = variant.description ?? null;

      const scope = variant.scope;
      // TODO: Check scope

      list.push(AnvilCompletionDetail.create(label, insertText, lspKind, hint, { desc: desc ?? undefined }, 'builtinKeyword'));
    }
    return list;
  }

  public static snippetFromNode(label: string, insertText: string, node: AnvilAstNode): AnvilCompletionDetail {
    const typedef = node.resolveAs(AnvilTypeSchema);
    const useTypedefData = typedef?.type === 'record' || typedef?.type === 'variant';
    const entry =
      (useTypedefData ? completionInfo.getKindMetadata(typedef.data_type.kind, typedef.data_type.type) : null) ??
      (completionInfo.getKindMetadata(node.kind, node.type));

    const lspKind = (CompletionItemKind as any)[entry?.lspKind ?? 'Text'] ?? CompletionItemKind.Text;
    const hint = entry?.hint ?? '';
    return AnvilCompletionDetail.create(label, insertText, lspKind, hint, { node }, 'astNode');
  }

  public static basicFromNode(insertText: string, node: AnvilAstNode): AnvilCompletionDetail {
    return this.snippetFromNode(insertText, insertText, node);
  }

  public get isSnippet() {
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
      data: "node" in d
        ? { filepath: d.node?.filepath, nodepath: d.node?.nodepath, desc: d.desc, source: this.source }
        : { ...d, source: this.source },
      detail: this.hint,
      insertText: insertText,
      insertTextFormat: this.isSnippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
      command: this.isSnippet ? {
        // Trigger parameter hints after inserting a snippet,
        // since some snippets may contain placeholders that can be filled in,
        // and LSP doesn't mandate that this is fired.
        //
        // This is NOT an LSP command, it's a VSCode-specific command.
        //
        // TODO: add a toggle in settings to configure compatibility modes
        title: 'Trigger Parameter Hints',
        command: 'editor.action.triggerParameterHints'
      } : undefined
    };
  }

}

export class AnvilCompletionGenerator {

  public static readonly TRIGGER_CHARS = ['.', '*', '<', '{', '(', '[', ':', '=', '@', '#', ' '];

  public static readonly SPACER_REGEX_GROUP = "(^|[\\s\\(\\[{])";
  public static readonly IDENTIFIER_REGEX_GROUP = "([a-zA-Z_][a-zA-Z0-9_]*)";
  public static readonly TYPEDEF_REGEX_GROUP = "([a-zA-Z_][a-zA-Z0-9_<>\\(\\)\\[\\]]*)";
  public static readonly LIFETIME_IDENTIFIER_REGEX_GROUP = "(#[~0-9]+|[#a-zA-Z_][a-zA-Z0-9_]*[+0-9]*)";


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

    const callCompletions = this.checkCallHeuristics(position, document);
    if (callCompletions !== null) {
      return callCompletions;
    }

    const constructSyntaxCompletions = this.checkConstructSyntaxHeuristics(position, document);
    if (constructSyntaxCompletions !== null) {
      return constructSyntaxCompletions;
    }

    const typedefCompletions = this.checkTypedefHeuristics(position, document);
    if (typedefCompletions !== null) {
      return typedefCompletions;
    }

    const typedefParamCompletions = this.checkTypedefParamHeuristics(position, document);
    if (typedefParamCompletions !== null) {
      return typedefParamCompletions;
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
    const regs = ast.closestNode(
      document.filepath, position.line, position.character,
      AnvilProcSchema
    )
      ?.down("body")
      .satisfyingType("native")
      ?.down("regs")
      .children

    if (!regs) return null;

    const matchingRegs = regs.filter(r => r.name?.startsWith(regPartialNamePrefix));

    return matchingRegs.map(r => AnvilCompletionDetail.basicFromNode(r.name!, r));
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
    const regs = ast.closestNode(
      document.filepath, position.line, position.character,
      AnvilProcSchema
    )
      ?.down("body")
      .satisfyingType("native")
      ?.down("regs")
      .children;

    if (!regs) return null;

    const matchingRegs = regs.filter(r => r.name?.startsWith(regPartialNamePrefix));

    return matchingRegs.map(r => AnvilCompletionDetail.snippetFromNode(
      r.name!,
      r.name! + '$1 := $0',
      r
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
    const endpoints = ast.closestNode(
      document.filepath, position.line, position.character,
      AnvilProcSchema
    )
      ?.down("args")
      .children;

    const matchingEndpoints = endpoints?.filter(e => e.name?.startsWith(endpointPartialNamePrefix)) || [];

    // Attempt: channel_def search
    const channels = ast.closestNode(
      document.filepath, position.line, position.character,
      AnvilProcSchema
    )
      ?.down("body")
      .satisfyingType("native")
      ?.down("channels")
      .children;

    const matchingChannels = channels
      ?.filter(c => c.names.find(n => n.startsWith(endpointPartialNamePrefix)))
      || [];

    const endpointCandidates = [...matchingEndpoints, ...matchingChannels];

    console.log(`Found ${endpointCandidates.length} endpoint candidates for prefix "${endpointPartialNamePrefix}"`);

    if (!messagePartialNamePrefix && !hasDot) {
      // If we haven't completed the endpoint, return endpoints.
      return endpointCandidates.flatMap(e => e.names.map(n => AnvilCompletionDetail.basicFromNode(n!, e)));
    }

    // We have an endpoint now!
    const selectedEndpointName = endpointPartialNamePrefix;

    let messageCompletions: AnvilAstNode[] = [];
    for (const endpointCandidate of endpointCandidates) {
      const channelClassDef = endpointCandidate
        .definitions
        .map(d => ast.node(d)?.satisfying(AnvilChannelClassSchema))
        .find(c => !!c);

      if (!channelClassDef) continue;

      let isOut = false;

      if (isSend) isOut = !isOut;

      if (endpointCandidate.kind === 'channel_def' &&
          endpointCandidate.down("endpoint_right")?.resolve() === selectedEndpointName) {
        isOut = !isOut;
      }

      const dir = isOut ? "out" : "in";

      const messages = channelClassDef.down("messages").children;
      const matchingMessages = messages
        .filter(m => m.down("dir").resolve() === dir)
        .filter(m => m.name?.startsWith(messagePartialNamePrefix));

      messageCompletions.push(...matchingMessages);
    }

    console.log(`Found ${messageCompletions.length} message candidates for prefix "${messagePartialNamePrefix}"`);

    return messageCompletions.map(m => AnvilCompletionDetail.snippetFromNode(
      m.name!,
      m.name! + (isSend ? "($1)$0" : ""),
      m
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

    const messageDefs = ast.closestNode(
      document.filepath, position.line, position.character,
      AnvilChannelClassSchema
    )?.down("messages").children
    .filter(n => n.kind === 'message_def')
    .filter(n => n.name !== identifier) || [];


    if (!hasRangeStartAnnot) {
      const hashPresentInPrefix = firstAnnotPrefix.startsWith('#');
      const H = !hashPresentInPrefix ? '#' : '';
      const hashReformat = (s: string) => {
        if (s.startsWith('#')) {
          return H + s.slice(1);
        } else {
          return s;
        }
      }

      // lifetime part — one fixed entry per lifetime key, plus per-message entries for %s patterns
      for (const key of completionInfo.knownLifetimeTimingKeys) {
        const entry = completionInfo.getLifetimeTimingEntry(key)!;
        const lspKind = (CompletionItemKind as any)[entry.lspKind] ?? CompletionItemKind.TypeParameter;

        if (!entry.insertText.startsWith('#') && hashPresentInPrefix) {
          // The snippet doesn't start with # but the user already typed a # (not a match)
          continue;
        }

        if (key.includes('%s')) {
          // Expand %s into one completion per sibling message
          for (const msgDef of messageDefs) {
            const msgName = msgDef.name!;
            const label       = key.replace(/%s/g, msgName);
            const insertText  = entry.insertText.replace(/%s/g, msgName);
            const description = entry.description?.replace(/%s/g, `\`${msgName}\``) ?? null;
            completionItems.push(AnvilCompletionDetail.create(
              hashReformat(label),
              hashReformat(insertText),
              lspKind,
              entry.hint,
              { node: msgDef, desc: description ?? undefined },
              'builtinKeyword'
            ));
          }
        } else {
          completionItems.push(AnvilCompletionDetail.create(
            hashReformat(key),
            hashReformat(entry.insertText),
            lspKind,
            entry.hint,
            { desc: entry.description ?? undefined },
            'builtinKeyword'
          ));
        }
      }

    } else {
      if (hasRangeStartAnnot && !hasRangeStartAtSign) {
        return [];
      }

      if (hasRangeEndAnnot && (!hasRangeEndAtSign || !hasRangeMidDash)) {
        return [];
      }

      const hashPresentInPrefix = (rangeStartAnnotPrefix.startsWith('#') && !hasRangeEndAnnot) || (rangeEndAnnotPrefix.startsWith('#'))
      const H = !hashPresentInPrefix ? '#' : '';
      const hashReformat = (s: string) => {
        if (s.startsWith('#')) {
          return H + s.slice(1);
        } else {
          return s;
        }
      }

      // synchronisation part — one fixed entry per sync key, plus per-message entries for %s patterns
      for (const key of completionInfo.knownSyncTimingKeys) {
        const entry = completionInfo.getSyncTimingEntry(key)!;
        const lspKind = (CompletionItemKind as any)[entry.lspKind] ?? CompletionItemKind.TypeParameter;

        if (key.includes('%s')) {
          // Expand %s into one completion per sibling message
          for (const msgDef of messageDefs) {
            const msgName = msgDef.name!;
            const rawLabel   = key.replace(/%s/g, msgName);
            const rawInsert  = entry.insertText.replace(/%s/g, msgName);

            if (!rawInsert.startsWith('#') && hashPresentInPrefix) {
              // The snippet doesn't start with # but the user already typed a # (not a match)
              continue;
            }

            const finalLabel  = hashReformat(rawLabel);
            const finalInsert = hashReformat(rawInsert);
            const description = entry.description?.replace(/%s/g, `\`${msgName}\``) ?? null;
            completionItems.push(AnvilCompletionDetail.create(
              finalLabel,
              finalInsert,
              lspKind,
              entry.hint,
              { node: msgDef, desc: description ?? undefined },
              'builtinKeyword'
            ));
          }
        } else {
          // For non-%s entries that already start with '#', strip the leading '#' from
          // label/insertText when H is empty (it would be a duplicate '#').
          const finalLabel    = hashReformat(key);
          const finalInsert   = hashReformat(entry.insertText);

          if (!entry.insertText.startsWith('#') && hashPresentInPrefix) {
            // The snippet doesn't start with # but the user already typed a # (not a match)
            continue;
          }

          completionItems.push(AnvilCompletionDetail.create(
            finalLabel,
            finalInsert,
            lspKind,
            entry.hint,
            { desc: entry.description ?? undefined },
            'builtinKeyword'
          ));
        }
      }
    }
    return completionItems;
  }




  private static checkTypedefHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at:
    // - "(reg/chan/left/right) typename : typedef"
    const regex = new RegExp(`^\\s*(reg|left|right|let)\\s+${this.IDENTIFIER_REGEX_GROUP}\\s*(:)?\\s*(\\()?${this.TYPEDEF_REGEX_GROUP}?$`, "g");
    console.log('Checking typedef completion heuristic with regex:', regex);
    const match = regex.exec(prefix);

    if (!match) {
      console.log('Typedef completion heuristic did not match.');
      return null;
    }

    console.log('Typedef completion heuristic matched!');
    const keyword = match[1];
    const hasColon = !!match[3];
    const hasOpenParen = !!match[4];
    const typedefPartialPrefix = match[5] || '';
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
      if (!hasOpenParen && !typedefPartialPrefix) {
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



  private static checkTypedefParamHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at: "typename<" for snippet completion
    const regex = new RegExp(`${this.SPACER_REGEX_GROUP}${this.IDENTIFIER_REGEX_GROUP}<$`, "g");
    console.log('Checking typedef parameter completion heuristic with regex:', regex);
    const match = regex.exec(prefix);

    if (!match) {
      console.log('Typedef parameter completion heuristic did not match.');
      return null;
    }

    console.log('Typedef parameter completion heuristic matched!');
    const typeName = match[2];
    const paramPartialPrefix = match[3] || '';
    const ast = document.anvilAst;
    if (!ast) return null;

    // Locate the type def for the given type name.
    const typeDefs = this.getAllNodes(
      position, document,
      { filter: n => !!(n.kind === "type_def" && n.name === typeName) }
    ).filter(n => n.kind === 'type_def');

    if (typeDefs.length === 0) {
      console.log(`No type definitions found for type name "${typeName}"`);
      return [];
    }

    const typeDef = typeDefs[0];

    // Get the parameter list for the type def, and filter by prefix.
    const params = typeDef.down("data_type").down("params").children;
    const matchingParams = params.map(p => p.name).filter(n => !!n);

    console.log(`Found ${matchingParams.length} typedef parameter candidates for prefix "${paramPartialPrefix}"`);

    if (matchingParams.length === 0) {
      return [];
    }

    const snippet = '<' + matchingParams.map((p, i) => `\${${i + 1}:${p}}`).join(', ') + '>';

    return [AnvilCompletionDetail.create(
      "<...>",
      snippet.slice(1) /* remove the leading < since it's already in the regex matching rule */,
      CompletionItemKind.TypeParameter,
      `type parameters`,
      { node: typeDef }
    )];
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

      return AnvilCompletionDetail.snippetFromNode(
        name,
        name + paramFormat + endpointFormat,
        p
      );
    });

    console.log(`Found ${results.length} proc candidates for prefix "${procPartialNamePrefix}"`);
    return results;
  }



  private static checkCallHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at: "call func_name" excluding the trailing "("
    const regex = new RegExp(`${this.SPACER_REGEX_GROUP}call\\s+${this.IDENTIFIER_REGEX_GROUP}?$`, "g");
    console.log('Checking call completion heuristic with regex:', regex);

    const match = regex.exec(prefix);
    if (!match) {
      console.log('Call completion heuristic did not match.');
      return null;
    }

    console.log('Call completion heuristic matched!');
    const funcPartialNamePrefix = match[2] || '';
    const ast = document.anvilAst;
    if (!ast) return null;

    // Locate all func_defs in the document and filter by prefix.
    const funcs = this.getAllNodes(
      position, document,
      { filter: n => !!(n.kind === "func_def" && n.name?.startsWith(funcPartialNamePrefix)) }
    );

    const results = funcs.map(f => {
      const name = f.name!;
      const args = f.down("args")?.children.map(c => c.name).filter(n => !!n) || [];

      const argFormat = args.length > 0
        ? '(' + args.map((a, i) => `\${${i + 1}:${a}}`).join(', ') + ')'
        : '()';

      return AnvilCompletionDetail.snippetFromNode(
        name,
        name + argFormat,
        f
      );
    });

    console.log(`Found ${results.length} func candidates for prefix "${funcPartialNamePrefix}"`);
    return results;
  }



  private static checkConstructSyntaxHeuristics(position: Position, document: AnvilDocument): AnvilCompletionDetail[] | null {
    const prefix = this.getPrefixAtPosition(position, document);

    // Heuristic matches when cursor is at: "typename::"
    const regex = new RegExp(`${this.SPACER_REGEX_GROUP}${this.TYPEDEF_REGEX_GROUP}(:(:({|${this.IDENTIFIER_REGEX_GROUP})?)?)?$`, "g");
    console.log('Checking construct syntax completion heuristic with regex:', regex);
    const match = regex.exec(prefix);
    if (!match) {
      console.log('Construct syntax completion heuristic did not match.');
      return null;
    }

    console.log('Construct syntax completion heuristic matched!');
    const typeName = match[2];
    const memberPartialPrefix = match[3] || '';
    const ast = document.anvilAst;
    if (!ast) return null;

    // Locate the type def for the given type name.
    const typeDefs = this.getAllNodes(
      position, document,
      { filter: n => !!(n.kind === "type_def" && n.name === typeName) }
    )
    .map(n => n.satisfying(AnvilTypeSchema))
    .filter(n => !!n);

    if (typeDefs.length === 0) {
      console.log(`No type definitions found for type name "${typeName}"`);
      return memberPartialPrefix.startsWith(':') ? [] : null;
    }

    for (const typeDef of typeDefs) {
      switch (typeDef.down("data_type").down("type").resolve()) {
        case 'record': {
          // struct-like type, look for fields
          const fields = typeDef.down("data_type").down("elements").children;
          const fieldNames = fields.flatMap(f => f.name).map(n => n || '').filter(n => n);

          // completion syntax is typename::{name1 = $1, name2 = $2, ...}
          const previewTemplate = '::{' + fieldNames.map(n => `${n} = ...`).join('; ') + '}';
          let fieldTemplate = '::{' + fieldNames.map((n, i) => `${n} = \${${i + 1}}`).join('; ') + '}'

          console.log(`Found ${fieldNames.length} field candidates for prefix "${memberPartialPrefix}"`);

          if (!fieldTemplate.startsWith(memberPartialPrefix)) {
            continue;
          }

          fieldTemplate = fieldTemplate.slice(memberPartialPrefix.length);

          return [AnvilCompletionDetail.snippetFromNode(
            previewTemplate,
            fieldTemplate,
            typeDef
          )];
        }
        case 'variant': {
          // enum-like type, look for variants
          const variants = typeDef.down("data_type").down("elements").children;
          const matchingVariants = variants
            .filter(v => v.name)
            .filter(v => ('::' + v.name).startsWith(memberPartialPrefix));

          console.log(`Found ${matchingVariants.length} variant candidates for prefix "${memberPartialPrefix}"`);

          return matchingVariants.map(v => AnvilCompletionDetail.snippetFromNode(
            v.name!,
            memberPartialPrefix.startsWith('::')
              ? v.name! :
            memberPartialPrefix.startsWith(':')
              ? ':' + v.name!
              : '::' + v.name!,
            v
          ));
        }
        default: {
          console.log(`Type definition "${typeName}" is not a record or variant, no construct syntax completions available.`);
          break;
        }
      }
    }

    return memberPartialPrefix.startsWith(':') ? [] : null;
  }



  private static getAllNodes<T = any, S = any>(
    position: Position, document: AnvilDocument,
    options?: {
      scoped?: z.ZodType<S>,
      filter?: ((node: AnvilAstNode) => boolean) | z.ZodType<T>,
      relnodepath?: AnvilAstNodePath
    }
  ): AnvilAstNode<T>[] {

    const ast = document.anvilAst;
    const filter = options?.filter ?? (() => true);
    const scoped = options?.scoped ?? false;
    const relnodepath = options?.relnodepath;

    if (!ast) return [];

    let nodeList: AnvilAstNode<unknown>[] = (
      relnodepath ?
        (
          scoped ?
            Array.of(...(
              ast.closestNode(document.filepath, position.line, position.character, scoped)
                ?? ast.root(document.filepath)
            )?.unsafeTraverse(...relnodepath).children ?? []) :
            ast.getAllRoots().flatMap(n => n.unsafeTraverse(...relnodepath).children)
        ) as unknown[] as AnvilAstNode<unknown>[] :
        (
          scoped ?
            Array.of(...(
              ast.closestNode(document.filepath, position.line, position.character, scoped)
                ?? ast.root(document.filepath)
            )?.getAllDescendants() ?? []) :
            ast.getAllLocatableNodes().map(l => ast.node(l)).filter(n => !!n)
        )
    );


    if (filter instanceof z.ZodType) {
      nodeList = nodeList.filter(n => n.satisfies(filter));
    } else {
      nodeList = nodeList.filter(n => filter(n));
    }

    return nodeList as AnvilAstNode<T>[];
  }

  private static getAllEntries(nodes: AnvilAstNode[]) {
    return nodes.flatMap((node) => {
      if (!node) return null;

      let identifiers: string[] = [];
      identifiers.push(...node.names);

      let list: AnvilCompletionDetail[] = [];

      for (const name of identifiers) {
        if (!name) return null;

        list.push(AnvilCompletionDetail.basicFromNode(name, node));
      }

      return list;
    })
    .filter(c => c)
    .map(c => c!) ?? [];
  }

  private static getAnvilBuiltinCompletions(category?: string | null, filter?: string[]): AnvilCompletionDetail[] {
    const completionItems: AnvilCompletionDetail[] = [];

    for (const keyword of completionInfo.knownKeywords) {
      if (filter && !filter.includes(keyword)) continue;
      completionItems.push(...AnvilCompletionDetail.fromKeyword(keyword, category));
    }

    return completionItems;
  };


}
