import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { AnvilDocument } from '../core/AnvilDocument';
import { AnvilLspUtils } from '../utils/AnvilLspUtils';
import { AnvilAstNode, AnvilEventInfo } from '../core/ast/AnvilAst';
import z from 'zod';
import {
  AnvilMessageDefSchema,
  AnvilMessageSyncMode,
} from '../core/ast/schema';
import { astNodeInfo } from '../info/parsed';
import { diagnosticsLogger } from '../utils/logger';
import {
  formatCycleTime,
  isZeroCycleTime,
} from '../utils/AnvilCycleTimeFormatter';

export class AnvilDescriptionGenerator {
  private constructor() {}

  //
  // PUBLIC API: diagnostics
  //

  /**
   * Describes the diagnostics for a given AnvilDocument, converting them into LSP Diagnostics.
   */
  static async describeDiagnostics(
    anvilDocument: AnvilDocument,
    limit?: number,
  ): Promise<Diagnostic[]> {
    let problems = 0;

    const diagnostics: Diagnostic[] = [];
    const uri = anvilDocument.textDocument.uri;

    const result = { errors: anvilDocument.anvilErrors ?? [] };

    diagnosticsLogger.info(
      'generating diagnostics for',
      uri,
      'with',
      result.errors.length,
      'errors',
    );

    for (const error of result.errors) {
      problems++;
      if (limit && problems > limit) {
        break;
      }

      if (!anvilDocument.filepath.endsWith(error.filepath)) {
        // skip external errors for now
        // external errors require resolving paths which are not yet implemented
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: Number.MAX_VALUE },
          },
          message: `Dependency Errored at ${error.filepath}:${error.span.start.line}:${error.span.start.col}\n\n${error.message}`,
          source: 'anvil',
        });
        continue;
      }

      const errorTypeString = {
        warning: 'Warning',
        error: 'Error',
      };

      const errorTypeDiagnosticSeverity = {
        warning: DiagnosticSeverity.Warning,
        error: DiagnosticSeverity.Error,
      };

      const diagnostic: Diagnostic = {
        severity:
          errorTypeDiagnosticSeverity[error.type] || DiagnosticSeverity.Error,
        range:
          anvilDocument.getLspRangeOfAnvilSpan(error.span) ??
          AnvilLspUtils.anvilSpanToLspRange(error.span),
        message: error.message,
        source: 'anvil',
      };

      diagnostic.relatedInformation = [];

      const mainMessage = `Anvil Compiler ${errorTypeString[error.type] || 'Error'}`;

      if (error.supplementaryInfo) {
        for (const info of error.supplementaryInfo) {
          diagnostic.relatedInformation.push({
            location: {
              uri: uri,
              range:
                anvilDocument.getLspRangeOfAnvilSpan(info.span) ??
                AnvilLspUtils.anvilSpanToLspRange(info.span),
            },
            message: `${mainMessage} (${info.message})`,
          });
        }
      }

      diagnostics.push(diagnostic);
    }
    return diagnostics;
  }

  //
  // HELPERS
  //

  private static nodeType(n: AnvilAstNode): string | null {
    switch (n.kind) {
      case 'expr':
        return n.type ?? 'expr';
    }
    return n.kind;
  }

  /**
   * Formats an AnvilEventInfo as a human-friendly cycle string.
   * e.g. "cycle 1 + (5/n1) + max{n2, n3}" for complex delays.
   */
  private static formatEventCycle(e: AnvilEventInfo): string {
    const prevDelays = e.prevDelay;

    if (!prevDelays) {
      return 'cycle ?';
    }

    const formatted = formatCycleTime(prevDelays);
    return 'cycle ' + formatted;
  }

  /**
   * Returns a human-friendly lifetime description for the given node (or its parents),
   * or an empty string if no lifetime information is available.
   */
  private static describeLifetime(node: AnvilAstNode): string {
    // Walk up ancestor chain until we find a node with event info
    let event = node.event;
    let current: AnvilAstNode | null = node;
    while (!event && !current.isRoot()) {
      current = (current as AnvilAstNode).up();
      event = current?.event;
    }

    if (!event) {
      return '';
    }

    const isOriginalNode = current === node;

    const startStr = this.formatEventCycle(event);
    const sustained = node.sustainedTillEvent;
    const blockingDelay = event.nextDelay;

    const execStr = ` - Executes on \`${startStr}\`\n`;
    const blockingStr =
      blockingDelay && !isZeroCycleTime(blockingDelay) && isOriginalNode
        ? ` - Consumes \`${formatCycleTime(blockingDelay)}\` cycle(s)\n`
        : '';
    const sustainStr =
      sustained && isOriginalNode
        ? ` - Sustained till end of \`${this.formatEventCycle(sustained)}\`\n`
        : '';

    return execStr + blockingStr + sustainStr;
  }

  /**
   * Formats a single AnvilMessageSyncMode as a human-friendly timing phrase.
   * e.g. "at any time", "every 4 cycle(s) starting at cycle 2",
   *      "1 cycle(s) after message xyz"
   */
  private static formatSyncMode(
    endp: 'left' | 'right' | null,
    context: 'send' | 'recv' | null,
    sync: AnvilMessageSyncMode,
    other: AnvilMessageSyncMode,
  ): string {
    let text = '';
    switch (sync.type) {
      case 'dynamic':
        text = 'at any time';
        break;
      case 'static':
        text = `every \`${sync.interval}\` cycle(s) starting on \`cycle ${sync.init}\`${
          other.type === 'dynamic'
            ? context === 'recv'
              ? // we do a fixed receive from the other side's dynamic send
                // -> our start point depends the other side actually sending
                " of sender's send"
              : // we do a fixed send to the other side's dynamic receive
                // -> nothing to note for us
                ''
            : ''
        }`;
        break;
      case 'dependent':
        text = `\`${sync.delay}\` cycle(s) after \`${sync.msg}\` begins exchange`;
        break;
    }
    if (endp) {
      switch (context) {
        case 'send':
          text = `\`${endp}\` endpoint sends ${text}`;
          break;
        case 'recv':
          text = `\`${endp}\` endpoint receives ${text}`;
          break;
      }
    } else if (context) {
      switch (context) {
        case 'send':
          text = `send ${text}`;
          break;
        case 'recv':
          text = `receive ${text}`;
          break;
      }
      text = sync.type === 'dynamic' ? `May ${text}` : `Must ${text}`;
    }
    return text;
  }

  /**
   * Returns a human-friendly description of the timing contracts for a message_def node,
   * as a markdown bullet list, or an empty string if the node is not a message_def.
   */
  private static describeMessageDefContracts(
    msgNode: AnvilAstNode,
    context?: 'send' | 'recv',
  ): string {
    const msg = msgNode.resolveAs(AnvilMessageDefSchema);
    if (!msg) return '';

    const lifetime =
      msg.sig_types.length === 1 ? msg.sig_types[0].lifetime : null;
    let lifetimeStr;
    switch (lifetime?.ending.type) {
      case 'cycles':
        lifetimeStr = `- Must be sustained for \`${lifetime.ending.value}\` cycle(s)\n`;
        break;
      case 'message': {
        const offset = lifetime.ending.offset;
        lifetimeStr =
          '- Must be sustained ' +
          (offset
            ? offset > 0
              ? `till \`${offset}\` cycle(s) after \`${lifetime.ending.value}\` begins to be exchanged\n`
              : `till \`${-offset}\` cycle(s) before \`${lifetime.ending.value}\` is exchanged\n`
            : `till before \`${lifetime.ending.value}\` is exchanged\n`);
        break;
      }
      case 'eternal':
        lifetimeStr = `- Must be sustained indefinitely\n`;
        break;
      default:
        lifetimeStr = '';
    }

    // Contextual mode: omit the endpoint side label (caller already knows which side they're on)
    if (context === 'send') {
      lifetimeStr =
        `- ${this.formatSyncMode(null, context, msg.send_sync, msg.recv_sync)}\n` +
        lifetimeStr;
      return lifetimeStr;
    }
    if (context === 'recv') {
      lifetimeStr =
        `- ${this.formatSyncMode(null, context, msg.recv_sync, msg.send_sync)}\n` +
        lifetimeStr;
      return lifetimeStr;
    }

    // dir is from the left endpoint's perspective:
    //   "out" -> left sends,  right receives
    //   "in"  -> left receives, right sends
    const leftSends = msg.dir === 'out';
    const senderSide = leftSends ? 'left' : 'right';
    const receiverSide = leftSends ? 'right' : 'left';

    // Full mode: include endpoint side labels
    const sendLine = `- ${this.formatSyncMode(senderSide, 'send', msg.send_sync, msg.recv_sync)}\n`;
    const recvLine = `- ${this.formatSyncMode(receiverSide, 'recv', msg.recv_sync, msg.send_sync)}\n`;
    if (leftSends) {
      return sendLine + recvLine + lifetimeStr;
    } else {
      return recvLine + sendLine + lifetimeStr;
    }
  }

  /**
   * Returns a human-readable label for the node kind (e.g. "process", "register"),
   * falling back to the raw kind string when no entry is found in ast-node-info.json.
   */
  private static nodeLabel(n: AnvilAstNode): string {
    const entry = astNodeInfo.getFor(n);
    return entry?.name ?? this.nodeType(n) ?? '';
  }

  private static getTextForNode(
    node: AnvilAstNode,
    anvilDocument: AnvilDocument,
    supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null,
  ): { text: string; source: AnvilDocument } | null {
    if (!node.span) {
      return null;
    }

    let bestDoc = anvilDocument;

    if (
      node.filepath ===
      anvilDocument.anvilAst?.root(anvilDocument.filepath)?.filepath
    ) {
      // node is in the main document
      // we can use the main document for text retrieval
    } else {
      // attempt to find a supplementary document that contains the node
      const suppl = supplementaryDocuments?.(node);
      if (suppl) {
        bestDoc = suppl;
      } else {
        return null;
      }
    }

    return {
      text: bestDoc.textDocument.getText(
        bestDoc.getLspRangeOfAnvilSpan(node.span!) ??
          AnvilLspUtils.anvilSpanToLspRange(node.span!),
      ),
      source: bestDoc,
    };
  }

  //
  // PUBLIC API: node descriptions
  //

  static getNodeDefinitionStr(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accept any AST node kind for flexible description generation
    node: AnvilAstNode<any>,
    anvilDocument: AnvilDocument,
    supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null,
    options?: { expanded?: boolean | 'auto' },
  ): string {
    const kind = this.nodeType(node);
    const kindStr =
      kind && node.isLabelled ? `/* ${this.nodeLabel(node)} */\n` : '';

    const span = node.span;

    if (span) {
      const _defRetrievedRawText = this.getTextForNode(
        node,
        anvilDocument,
        supplementaryDocuments,
      );

      const defRawStr =
        _defRetrievedRawText?.text ?? '/* (definition lookup failed) */';
      const isSupplementary = _defRetrievedRawText?.source !== anvilDocument;

      const defLines = defRawStr.split('\n');

      let prefix = '';
      const nodeFilepath = node.absoluteSpan?.filepath;
      if (nodeFilepath && isSupplementary) {
        prefix = `/* ${nodeFilepath} */\n`;
      }

      // determine whether to expand the definition based on options and kind
      let expanded: boolean;
      let operOnly: boolean | string = false;

      if ((options?.expanded ?? 'auto') === 'auto') {
        switch (kind) {
          case 'channel_class_def':
          case 'type_def':
          case 'sig_def':
          case 'macro_def':
          case 'spawn_def':
          case 'channel_def':
          case 'message_def':
          case 'endpoint_def': {
            expanded = true;
            break;
          }
          case 'wait':
          case 'join':
          case 'binop':
          case 'unop': {
            operOnly = true;
            // fallthrough
          }
          default: {
            expanded = false;
          }
        }
      } else {
        expanded = !!options?.expanded;
      }

      // handle operator-only case
      if (operOnly) {
        switch (kind) {
          case 'unop':
          case 'binop': {
            operOnly = `/* ${node.down('op').resolveAs(z.string()) || ''} */`;
            break;
          }
          case 'wait': {
            operOnly = kindStr.trim() + ' >>';
            break;
          }
          case 'join': {
            operOnly = kindStr.trim() + ' ;';
            break;
          }
        }

        if (typeof operOnly === 'string') {
          return operOnly + '\n';
        } else {
          return kindStr + prefix;
        }
      }

      // handle non-expanded case
      if (!expanded) {
        if (defRawStr.trim().endsWith('}')) {
          // If the definition is a block, we want to trim it to just the signature for the hint
          const signatureMatch = defRawStr.match(/^[^{]*/);
          if (signatureMatch) {
            return (
              kindStr + prefix + `${signatureMatch[0].trim()} { /* ... */ }\n`
            );
          }
        }

        // If it's not a block, we can just return the first line
        return (
          kindStr +
          prefix +
          `${defLines[0].trim()} ` +
          (defLines.length > 1 ? ' /* ... */\n' : '\n')
        );
      }

      // reformat definition lines
      let minIndentCount = Infinity;
      for (let lineI = 0; lineI < defLines.length; lineI++) {
        // ignore first line (span excludes indentation from first line)
        if (lineI === 0) continue;

        const line = defLines[lineI];

        // count leading spaces in the first line to determine indentation level
        const leadingSpaces = line.match(/^[ \t]*/)?.[0].length ?? 0;
        if (leadingSpaces < minIndentCount && line.trim().length > 0) {
          minIndentCount = leadingSpaces;
        }
      }

      if (minIndentCount === Infinity) {
        minIndentCount = 0;
      }

      const trimmedDefLines = defLines.map((line, i) =>
        i ? line.substring(minIndentCount).trimEnd() : line.trimEnd(),
      );

      // return result
      return kindStr + prefix + trimmedDefLines.join('\n') + '\n';
    }

    return '';
  }

  /**
   * Generates a short one-line hint for the given node, returning a markdown string that can be used in hover or other LSP features.
   */
  static hintNode(
    node: AnvilAstNode,
    anvilDocument: AnvilDocument,
    supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null,
  ): string {
    const span = node.span;

    if (span) {
      return (
        '```anvil\n' +
        this.getNodeDefinitionStr(node, anvilDocument, supplementaryDocuments, {
          expanded: false,
        }) +
        '```'
      );
    }
    return '';
  }

  /**
   * Describes the given node succintly, returning a markdown string that can be used in hover or other LSP features.
   *
   * Use the `segments` option to control which sections appear in the output.
   * All segments default to `false`; callers must explicitly opt in to each one.
   */
  static describeNode(
    node: AnvilAstNode,
    anvilDocument: AnvilDocument,
    supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null,
    segments?: {
      /** Anvil code block showing the node's own source text. */
      code?: boolean;
      /** Documentation for this node's kind from ast-node-info.json. */
      documentation?: boolean;
      /** Definitions referenced by this node. */
      definitions?: boolean;
      /** Human-friendly lifetime/timing description for this node. */
      lifetime?: boolean;
      /** Explanations of the node */
      explanations?: boolean;
      /** Code examples from ast-node-info.json. Only shown when explanations is also true. */
      examples?: boolean;
      /** Internal debug information (path, kind, span, raw JSON). */
      debug?: boolean;
    },
  ): string {
    let codeSegment = '';
    const documentationSegment = '';
    let definitionsSegment = '';
    let lifetimeSegment = '';
    let explanationSegment = '';
    let debugPathSegment = '';

    // populate code segment
    if (segments?.code) {
      const defFullStr = this.getNodeDefinitionStr(
        node,
        anvilDocument,
        supplementaryDocuments,
        { expanded: 'auto' },
      );
      codeSegment = '```anvil\n' + defFullStr + '```\n';
    }

    // populate definitions segment
    if (segments?.definitions) {
      const defs = node.definitions;
      const defStrFormatter = (node: AnvilAstNode) => {
        return this.getNodeDefinitionStr(
          node,
          anvilDocument,
          supplementaryDocuments,
          { expanded: defs.length <= 1 ? 'auto' : false },
        );
      };

      const defStrs = defs
        .map((def) => anvilDocument.anvilAst?.node(def))
        .filter((def) => def)
        .map((def) => defStrFormatter(def!));

      if (defStrs.length > 0) {
        if (segments?.code) {
          definitionsSegment += '\n\n---\n\n';
          definitionsSegment += '**Definitions:**\n\n';
        }

        definitionsSegment += '```anvil\n' + defStrs.join('\n') + '```\n';
      }
    }

    // populate lifetime segment
    if (segments?.lifetime) {
      const lifetimeParts: string[] = [];

      // message_def: show its timing contracts
      if (node.kind === 'message_def') {
        const contracts = this.describeMessageDefContracts(node);
        if (contracts) lifetimeParts.push(contracts);
      }

      if (node.kind === 'expr') {
        // send/recv expression — show the contextual contract from the referenced message_def,
        //                        plus the node's own event timing
        const type = node.type;
        const isSend = type === 'send' || type === 'try_send';
        const isRecv = type === 'recv' || type === 'try_recv';

        if (isSend || isRecv) {
          const context: 'send' | 'recv' = isSend ? 'send' : 'recv';
          const defs = node.definitions;
          for (const def of defs) {
            const defNode = anvilDocument.anvilAst?.node(def);
            if (defNode?.satisfiesKind('message_def')) {
              const contracts = this.describeMessageDefContracts(
                defNode,
                context,
              );
              if (contracts) lifetimeParts.push(contracts);
              break;
            }
          }
        }
      }

      // All nodes: show event timing if available
      const lifetimeDesc = this.describeLifetime(node);
      if (lifetimeDesc) lifetimeParts.push(lifetimeDesc);

      // Merge parts together with a header if there are any
      if (lifetimeParts.length > 0) {
        const hasAbove = !!(
          documentationSegment ||
          codeSegment ||
          definitionsSegment
        );
        const sep = hasAbove ? '\n\n---\n\n' : '';
        lifetimeSegment =
          sep + '**Lifetime:**\n\n' + lifetimeParts.join('') + '\n';
      }
    }

    // populate explanation segment
    if (segments?.explanations) {
      const entry = astNodeInfo.getFor(node);

      if (entry && !entry.internal) {
        const hasAbove = !!(
          documentationSegment ||
          codeSegment ||
          definitionsSegment
        );
        const sep = hasAbove ? '\n\n---\n\n' : '';

        explanationSegment =
          sep + '**Anvil Info:**\n\n' + entry.description + '\n';

        if (segments?.examples && entry.examples) {
          explanationSegment += '\n**Examples:**\n\n' + entry.examples + '\n';
        }
      }
    }

    // populate debug segment
    if (segments?.debug) {
      debugPathSegment +=
        '\n\n---\n\n**DEBUG**\n\n' +
        `**- Node Path:** ${node.nodepath.map((s) => `\`${s}\``).join('.')}\n` +
        `**- Node Kind:** ${node.kind || 'unknown'}/${node.type || '-'}\n` +
        `**- Node Span:** ${node.span ? `${node.span.start.line}:${node.span.start.col}-${node.span.end.line}:${node.span.end.col}` : 'none'}\n` +
        `**- Node Defs:** ${node.definitions.length}\n` +
        '\n---\n\n' +
        'Raw Data:\n\n' +
        '```json\n' +
        JSON.stringify(node.resolve(), null, 2) +
        '\n```\n';
    }

    return (
      codeSegment +
      documentationSegment +
      definitionsSegment +
      lifetimeSegment +
      explanationSegment +
      debugPathSegment
    );
  }

  /**
   * Explains the given node in detail, returning a markdown string that can be used in hover or other LSP features.
   */
  static explainNode(
    node: AnvilAstNode,
    anvilDocument: AnvilDocument,
    supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null,
  ): string {
    return this.describeNode(node, anvilDocument, supplementaryDocuments, {
      code: true,
      documentation: true,
      definitions: true,
      lifetime: true,
      explanations: true,
      examples: true,
      debug: false,
    });
  }
}
