import { ParameterInformation, Position, SignatureHelp, SignatureInformation } from "vscode-languageserver";
import { AnvilAstNode } from "./AnvilAst";
import { AnvilDocument } from "./AnvilDocument";
import { AnvilDescriptionGenerator } from "./AnvilDescriptionGenerator";
import { AnvilCompletionGenerator } from "./AnvilCompletionGenerator";

export class AnvilSignatureHelpGenerator {

  /** Characters that trigger signature help display. */
  public static readonly TRIGGER_CHARS = ['(', '{'];

  /** Characters that retrigger (update) an already-active signature help panel. */
  public static readonly RETRIGGER_CHARS = [',', ';', '='];

  /** Segment visibility used for all signature help documentation panels. */
  private static readonly SIGNATURE_SEGMENTS = { code: true, documentation: true } as const;

  // Reuse regex groups from the completion generator for consistency.
  private static readonly SPACER_REGEX_GROUP      = AnvilCompletionGenerator.SPACER_REGEX_GROUP;
  private static readonly IDENTIFIER_REGEX_GROUP  = AnvilCompletionGenerator.IDENTIFIER_REGEX_GROUP;
  private static readonly TYPEDEF_REGEX_GROUP     = AnvilCompletionGenerator.TYPEDEF_REGEX_GROUP;


  /**
   * Returns LSP SignatureHelp for the given cursor position, or null if no
   * signature context is detected.
   */
  public static getSignatureHelp(
    position: Position,
    document: AnvilDocument,
    getSupplementaryDoc: (node: AnvilAstNode) => AnvilDocument | null,
  ): SignatureHelp | null {

    const spawnHelp = this.checkSpawnSignatureHelp(position, document, getSupplementaryDoc);
    if (spawnHelp !== null) return spawnHelp;

    const sendHelp = this.checkSendSignatureHelp(position, document, getSupplementaryDoc);
    if (sendHelp !== null) return sendHelp;

    const recordHelp = this.checkRecordInitSignatureHelp(position, document, getSupplementaryDoc);
    if (recordHelp !== null) return recordHelp;

    return null;
  }


  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the text of the document from the start of the file up to but not
   * including the cursor position, for whole-file regex matching.
   */
  private static getPrefixAtPosition(position: Position, document: AnvilDocument): string {
    return document.textDocument.getText({
      start: { line: 0, character: 0 },
      end: position,
    });
  }

  /**
   * Counts the number of *top-level* occurrences of `separator` in the text
   * after the opening delimiter, ignoring occurrences nested inside matched
   * open/close pairs of the same characters.
   *
   * Example: `foo(a, bar(x, y), c` with separator=',', open='(', close=')'
   * returns 2 (two top-level commas).
   */
  private static countTopLevelSeparators(
    textAfterOpen: string,
    separator: string,
    openChar: string,
    closeChar: string,
  ): number {
    let depth = 0;
    let count = 0;
    for (let i = 0; i < textAfterOpen.length; i++) {
      const ch = textAfterOpen[i];
      if (ch === openChar)  { depth++; continue; }
      if (ch === closeChar) { depth--; continue; }
      if (depth === 0 && textAfterOpen.startsWith(separator, i)) {
        count++;
        i += separator.length - 1;
      }
    }
    return count;
  }

  /**
   * Builds a SignatureHelp response from the provided parts.
   */
  private static makeSignatureHelp(
    label: string,
    parameters: ParameterInformation[],
    activeParameter: number,
    documentation?: string,
  ): SignatureHelp {
    const sig: SignatureInformation = {
      label,
      parameters,
    };
    if (documentation) {
      sig.documentation = { kind: 'markdown', value: documentation };
    }
    return {
      signatures: [sig],
      activeSignature: 0,
      activeParameter: Math.max(0, Math.min(activeParameter, parameters.length - 1)),
    };
  }


  // ---------------------------------------------------------------------------
  // Heuristic 1: spawn <proc>(<args>)
  // ---------------------------------------------------------------------------

  private static checkSpawnSignatureHelp(
    position: Position,
    document: AnvilDocument,
    getSupplementaryDoc: (node: AnvilAstNode) => AnvilDocument | null,
  ): SignatureHelp | null {

    const prefix = this.getPrefixAtPosition(position, document);

    // Match: spawn <ProcName>[<TypeParams>](   with an unclosed '('
    const regex = new RegExp(
      `${this.SPACER_REGEX_GROUP}spawn\\s+(${this.TYPEDEF_REGEX_GROUP})\\(([^)]*)$`,
      'gs',
    );

    const match = regex.exec(prefix);
    if (!match) {
      console.log('[SignatureHelp] spawn heuristic did not match.');
      return null;
    }

    console.log('[SignatureHelp] spawn heuristic matched!');

    const procNameWithParams = match[2]; // e.g. "Alu<logic[4]>" or "Alu"
    // Extract base proc name (strip type params).
    const procBaseName = procNameWithParams.split('<')[0];

    const textAfterOpen = match[4] ?? ''; // text between '(' and cursor
    const activeParam = this.countTopLevelSeparators(textAfterOpen, ',', '(', ')');

    const ast = document.anvilAst;
    if (!ast) return null;

    // Find the proc_def by name across all roots.
    let procNode: AnvilAstNode | null = null;
    for (const root of ast.getAllRoots()) {
      const found = root.traverse('procs').children.find(p => p.name === procBaseName);
      if (found) { procNode = found; break; }
    }

    if (!procNode) {
      console.log(`[SignatureHelp] spawn: proc "${procBaseName}" not found in AST.`);
      return null;
    }

    // Build parameter list from endpoint args.
    const endpointArgs = procNode.down('args').children;

    const parameters: ParameterInformation[] = endpointArgs.map(ep => {
      const label = AnvilDescriptionGenerator.getNodeDefinitionStr(ep, document, getSupplementaryDoc).trim()
        || (ep.name ?? '?');
      return { label } satisfies ParameterInformation;
    });

    // Signature label = plain-text collapsed proc signature.
    const sigLabel = `${procNameWithParams}(${endpointArgs.map(e => e.name ?? '?').join(', ')})`;

    // Documentation panel = markdown (code block + docs).
    const sigDoc = AnvilDescriptionGenerator.describeNode(procNode, document, getSupplementaryDoc, this.SIGNATURE_SEGMENTS) || undefined;

    return this.makeSignatureHelp(sigLabel, parameters, activeParam, sigDoc);
  }


  // ---------------------------------------------------------------------------
  // Heuristic 2: send <endpoint>.<message>(<value>)
  // ---------------------------------------------------------------------------

  private static checkSendSignatureHelp(
    position: Position,
    document: AnvilDocument,
    getSupplementaryDoc: (node: AnvilAstNode) => AnvilDocument | null,
  ): SignatureHelp | null {

    const prefix = this.getPrefixAtPosition(position, document);

    // Match: send <endpoint>.<message>(   with an unclosed '('
    const regex = new RegExp(
      `${this.SPACER_REGEX_GROUP}send\\s+${this.IDENTIFIER_REGEX_GROUP}\\.${this.IDENTIFIER_REGEX_GROUP}\\(([^)]*)$`,
      'gs',
    );

    const match = regex.exec(prefix);
    if (!match) {
      console.log('[SignatureHelp] send heuristic did not match.');
      return null;
    }

    console.log('[SignatureHelp] send heuristic matched!');

    const endpointName = match[2];
    const messageName  = match[3];
    // always single arg so activeParam = 0

    const ast = document.anvilAst;
    if (!ast) return null;

    // Resolve the endpoint — could be a proc arg or a local channel_def endpoint.
    const procNode = ast.goToClosest(
      document.filepath, position.line, position.character,
      n => n.kind === 'proc_def',
    );

    if (!procNode) {
      console.log('[SignatureHelp] send: no enclosing proc_def found.');
      return null;
    }

    const procArgs = procNode.down('args').children;
    const channels  = procNode.traverse('body', 'channels').children;

    const endpointNode: AnvilAstNode | undefined =
      procArgs.find(e => e.name === endpointName) ??
      channels.find(c => c.names.includes(endpointName));

    if (!endpointNode) {
      console.log(`[SignatureHelp] send: endpoint "${endpointName}" not found in proc scope.`);
      return null;
    }

    // Resolve the channel class definition.
    const channelClassDef = endpointNode.definitions
      .map(d => ast.goTo(d))
      .find(n => n?.kind === 'channel_class_def');

    if (!channelClassDef) {
      console.log('[SignatureHelp] send: channel class def not found.');
      return null;
    }

    // Determine direction: send wants "out"; flip if endpoint is the right side of a channel_def.
    let isOut = true;
    if (
      endpointNode.kind === 'channel_def' &&
      endpointNode.down('endpoint_right').resolve() === endpointName
    ) {
      isOut = !isOut;
    }

    const dir = isOut ? 'out' : 'in';

    const messages = channelClassDef.traverse('messages').children;
    const messageNode = messages.find(
      m => m.down('dir').resolve() === dir && m.name === messageName,
    );

    if (!messageNode) {
      console.log(`[SignatureHelp] send: message "${messageName}" (${dir}) not found in channel class.`);
      return null;
    }

    // Signature label = plain-text collapsed message signature.
    const sigLabel = `send ${endpointName}.${messageName}(value)`;

    // Documentation panel = markdown (code block + docs).
    const sigDoc = AnvilDescriptionGenerator.describeNode(messageNode, document, getSupplementaryDoc, this.SIGNATURE_SEGMENTS) || undefined;

    // Single parameter: the data value.
    const parameters: ParameterInformation[] = [{ label: 'value' }];

    return this.makeSignatureHelp(sigLabel, parameters, 0, sigDoc);
  }


  // ---------------------------------------------------------------------------
  // Heuristic 3: Rec::{<field> = <value>; ...}
  // ---------------------------------------------------------------------------

  private static checkRecordInitSignatureHelp(
    position: Position,
    document: AnvilDocument,
    getSupplementaryDoc: (node: AnvilAstNode) => AnvilDocument | null,
  ): SignatureHelp | null {

    const prefix = this.getPrefixAtPosition(position, document);

    // Match: <TypeName>::{   with an unclosed '{'
    const regex = new RegExp(
      `${this.SPACER_REGEX_GROUP}(${this.IDENTIFIER_REGEX_GROUP})::(?:\\{([^}]*))?$`,
      'gs',
    );

    const match = regex.exec(prefix);
    if (!match) {
      console.log('[SignatureHelp] record init heuristic did not match.');
      return null;
    }

    console.log('[SignatureHelp] record init heuristic matched!');

    const typeName      = match[2];
    const textAfterOpen = match[4] ?? '';
    const activeParam   = this.countTopLevelSeparators(textAfterOpen, ';', '{', '}');

    const ast = document.anvilAst;
    if (!ast) return null;

    // Find the type_def of record kind.
    let typeDef: AnvilAstNode | null = null;
    for (const root of ast.getAllRoots()) {
      const found = root.traverse('type_defs').children.find(
        td => td.name === typeName && td.traverse('data_type', 'type').resolve() === 'record',
      );
      if (found) { typeDef = found; break; }
    }

    if (!typeDef) {
      console.log(`[SignatureHelp] record init: type "${typeName}" not found or not a record.`);
      return null;
    }

    const fields = typeDef.traverse('data_type', 'elements').children;

    const parameters: ParameterInformation[] = fields.map(f => {
      const label = AnvilDescriptionGenerator.getNodeDefinitionStr(f, document, getSupplementaryDoc).trim()
        || (f.name ?? '?');
      return { label } satisfies ParameterInformation;
    });

    if (parameters.length === 0) {
      console.log('[SignatureHelp] record init: no fields found.');
      return null;
    }

    // Signature label = plain-text collapsed type_def signature.
    const sigLabel = `${typeName}::{${fields.map(f => `${f.name ?? '?'} = ...`).join('; ')}}`;

    // Documentation panel = markdown (code block + docs).
    const sigDoc = AnvilDescriptionGenerator.describeNode(typeDef, document, getSupplementaryDoc, this.SIGNATURE_SEGMENTS) || undefined;

    return this.makeSignatureHelp(sigLabel, parameters, activeParam, sigDoc);
  }
}

