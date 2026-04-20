import { InlayHint, InlayHintKind } from 'vscode-languageserver';
import {
  AnvilServerSettings,
  resolveTimingInfo,
} from '../utils/AnvilServerSettings';
import { AnvilLspUtils } from '../utils/AnvilLspUtils';
import { inlayHintLogger } from '../utils/logger';
import { AnvilDocument } from '../core/AnvilDocument';
import { AnvilEventInfo } from '../core/ast/AnvilAst';
import {
  formatCycleTime,
  hasSymbolicParts,
  isZeroCycleTime,
} from '../utils/AnvilCycleTimeFormatter';

export class AnvilInlayHintGenerator {
  private constructor() {}

  //
  // PUBLIC API
  //

  /**
   * Generates inlay hints for the given Anvil document based on the provided server settings.
   */
  public static generateInlayHints(
    anvilDocument: AnvilDocument,
    settings: AnvilServerSettings,
  ): InlayHint[] {
    const hints: InlayHint[] = [];

    const timingHints = resolveTimingInfo(settings.showTimingInfo);
    if (timingHints.asInlayHints !== 'none') {
      hints.push(
        ...this.computeLifetimeInlayHints(anvilDocument, {
          mode: timingHints.asInlayHints,
          debug: settings.debug,
        }),
      );
    }

    return hints;
  }

  //
  // LIFETIME HINTS
  //

  /**
   * Computes inlay hints related to event cycles and lifetimes in the Anvil document, and returns them as InlayHint objects.
   */
  private static computeLifetimeInlayHints(
    anvilDocument: AnvilDocument,
    options: { mode: 'condensed' | 'full'; debug?: boolean },
  ): InlayHint[] {
    if (!anvilDocument.anvilAst) {
      inlayHintLogger.info(
        `No inlay hint info available for document ${anvilDocument.filepath}`,
      );
      return [];
    }

    const ascii = false;

    const lineCount = anvilDocument.textDocument.lineCount;

    const locs = anvilDocument.anvilAst.getAllLocatableNodes(
      anvilDocument.filepath,
    );

    const threadInject: { [lineno: number]: string } = [];
    const prefixInject: { [lineno: number]: string } = [];
    const postfixInject: { [lineno: number]: { [colno: number]: string } } = [];
    let maxPrefixTextLen = 0;

    const loneMarker = ascii ? ' - ' : ' ─ ';
    const startMarker = ascii ? ',- ' : ' ┌ ';
    const contMarker = ascii ? '|  ' : ' │ ';
    const endMarker = ascii ? "'- " : ' └ ';
    const markerLen = 3;

    // iterate through all locatable nodes, and find and record their event information.
    const formatEvent = (e: AnvilEventInfo | null) => {
      if (e === null) return null;

      const eid = e.eid;
      const delays = e.prevDelay;
      const hasUnknown = delays ? hasSymbolicParts(delays) : false;
      const formattedDelay = delays
        ? formatCycleTime(delays, { ascii, compact: true, maxLength: 12 })
        : '';

      const debugEid = options.debug ? ` (e${eid})` : '';
      const cyclePrefix = options.mode === 'full' ? 'cycle ' : 'c';
      const delayStr = delays
        ? cyclePrefix +
          (hasUnknown || formattedDelay.length > 3
            ? '{' + formattedDelay + '}'
            : formattedDelay) +
          debugEid
        : '';

      return delayStr || `${cyclePrefix}?${debugEid}`;
    };

    for (const loc of locs) {
      const node = anvilDocument.anvilAst?.node(loc);
      if (!node) continue;
      const event = formatEvent(node.event);
      const sustainLifetime = node.sustainLifetime;
      const nextDelay = node.event?.nextDelay ?? [];

      if (!event) continue;

      const lspStart = anvilDocument.getLspPosOfAnvilPos({
        line: loc.span.start.line,
        col: 0,
      });

      const lspEnd = anvilDocument.getLspPosOfAnvilPos({
        line: loc.span.end.line,
        col: loc.span.end.col,
      });

      const lspStartLine = lspStart?.line;
      const lspEndLine = lspEnd?.line;
      const lspEndCol = lspEnd?.character;

      if (lspStartLine === undefined || lspEndLine === undefined) {
        continue;
      }

      // prefix: indicate event cycle info
      for (let l = lspStartLine; l <= lspEndLine; l++) {
        // Assumption: locs are discovered pre-order
        //  - Inner nodes will override outer nodes if they share the same line,
        //    which is desirable for better specificity of inlay hints
        prefixInject[l] = event;
      }

      postfixInject[lspEndLine] = postfixInject[lspEndLine] || {};
      let postfixText = '';

      // postfix: indicate if this results in a forced delay
      if (nextDelay && !isZeroCycleTime(nextDelay)) {
        const waitLabel = ascii || options.mode === 'full' ? '+' : '⧖';
        const cycleUnit = options.mode === 'condensed' ? 'c' : ' cycle(s)';
        const hasUnknown = hasSymbolicParts(nextDelay);
        const formattedNextDelay = formatCycleTime(nextDelay, { ascii });
        const wrappedFormattedNextDelay =
          hasUnknown || formattedNextDelay.length > 3
            ? '{' + formattedNextDelay + '}'
            : formattedNextDelay;
        const waitDesc = ` ${waitLabel} ${wrappedFormattedNextDelay}${cycleUnit}`;
        postfixText += waitDesc;
      }

      // postfix: indicate sustain lifetime info, if applicable
      const sustainSymbol = ascii ? '~>' : '↘';
      postfixText += sustainLifetime
        ? options.mode === 'full'
          ? ` sustained for ${formatCycleTime(sustainLifetime, { ascii })} cycle(s) after execution`
          : ` ${sustainSymbol} ${formatCycleTime(sustainLifetime, { ascii, compact: true, maxLength: 12 })}c`
        : '';

      if (postfixText && lspEndCol !== undefined) {
        postfixInject[lspEndLine][lspEndCol] =
          options.mode === 'full'
            ? ` /* ${postfixText.trim()} */`
            : ` ${postfixText.trim()}`;
      }

      // track max length for alignment purposes later
      maxPrefixTextLen = Math.max(maxPrefixTextLen, event.length);
    }

    // expand max length for adding markers later to cycle indicators
    maxPrefixTextLen = Math.max(
      8,
      Math.ceil((maxPrefixTextLen + markerLen) / 4) * 4,
    );

    // iterate through all threads, and find and record their thread ids
    for (const t of anvilDocument.anvilAst
      .resolveRoot(anvilDocument.filepath)
      ?.event_graphs?.flatMap((g) => g.threads) ?? []) {
      const tid = t.tid;
      const span = t.span;

      const lspStartLine =
        (anvilDocument.getLspPosOfAnvilPos({
          line: span.start.line,
          col: 0,
        })?.line ?? AnvilLspUtils.anvilPosToLspPos(span.start).line) - 1;

      const text =
        options.mode === 'full' ? `___ thread ${tid} ___` : `__t${tid}__`;
      threadInject[lspStartLine] = text;
      maxPrefixTextLen = Math.max(maxPrefixTextLen, text.length);
    }

    // Log checkpoint.
    inlayHintLogger.info(
      `Found lifetime inlay hints (${Object.keys(prefixInject).length} (prefix) + ${Object.keys(postfixInject).length} (postfix)) for document ${anvilDocument.filepath}`,
    );

    // pad the prefix event information to be identical length for all lines
    const prefixPaddedInject: [number, string][] = [];
    for (let line = 0; line < lineCount; line++) {
      const threadText = threadInject[line];
      const cycleText = prefixInject[line];

      // pad with spaces to ensure inlay hints are right-aligned and code is left aligned
      if (threadText) {
        prefixPaddedInject.push([
          line,
          ' '.repeat(maxPrefixTextLen - threadText.length) + threadText,
        ]);
      } else if (cycleText) {
        prefixPaddedInject.push([
          line,
          ' '.repeat(maxPrefixTextLen - cycleText.length - markerLen) +
            cycleText,
        ]);
      } else {
        prefixPaddedInject.push([
          line,
          ' '.repeat(maxPrefixTextLen - markerLen),
        ]);
      }
    }

    // merge all prefix lines with the same event cycle into a single block with markers to indicate continuation
    const repeats_above: { [i: number]: boolean } = {};

    // - first pass: determine which lines have the same event cycle as the line above, and record in repeats_above
    let lastText = '';
    for (let i = 0; i < prefixPaddedInject.length; i++) {
      let currText = prefixPaddedInject[i][1].trim();
      if (options.debug) {
        currText = currText.replace(/\(e\d+\)/g, '(eX)');
      }

      // the text in THIS iteration repeats the above one if it is:
      // - identical to the previous non-empty text, and
      // - it is not currently switching to a new thread
      repeats_above[i] = currText === lastText && !threadInject[i];

      // the text in the NEXT iteration will see this text as the previous one if
      // - it is not empty, or
      // - it is a new thread marker
      if (currText || threadInject[i]) {
        lastText = threadInject[i] || currText;
      }
    }

    // - second pass: use the information in repeats_above to determine which marker to append to each line,
    //                and replace the text with spaces if it's a repeat of the line above
    for (let i = 0; i < prefixPaddedInject.length; i++) {
      if (threadInject[i]) {
        // marker space already reserved for thread header
        continue;
      }

      const currText = prefixPaddedInject[i][1].trim();
      if (!currText) {
        prefixPaddedInject[i][1] = ' '.repeat(maxPrefixTextLen);
        continue;
      }

      const before_is_blank = prefixPaddedInject[i - 1]?.[1].trim() === '';

      const before_eq_curr = repeats_above[i];
      const curr_eq_after = repeats_above[i + 1];

      if (before_is_blank && before_eq_curr) {
        // the previous text is blank, but we found that the current line repeats the previous non-blank line
        // search upwards till we find a non-blank line
        let j = i - 1;
        while (j >= 0 && prefixPaddedInject[j][1].trim() === '') {
          j--;
        }
        if (j >= 0) {
          const wasLone = prefixPaddedInject[j][1].endsWith(loneMarker);
          const wasEnd = prefixPaddedInject[j][1].endsWith(endMarker);
          if (wasLone) {
            prefixPaddedInject[j][1] =
              prefixPaddedInject[j][1].slice(0, -loneMarker.length) +
              startMarker;
          } else if (wasEnd) {
            prefixPaddedInject[j][1] =
              prefixPaddedInject[j][1].slice(0, -endMarker.length) + contMarker;
          }
        }

        // replace all blank lines from that point on with a contMarker to connect the indicators
        j += 1;
        while (j < i) {
          prefixPaddedInject[j][1] =
            ' '.repeat(maxPrefixTextLen - markerLen) + contMarker;
          j++;
        }
      }

      const prefix =
        options.debug || !before_eq_curr
          ? prefixPaddedInject[i][1]
          : ' '.repeat(maxPrefixTextLen - markerLen);

      if (!before_eq_curr && curr_eq_after) {
        // start of a new sequence of repeats, mark with startMarker
        prefixPaddedInject[i][1] = prefix + startMarker;
      } else if (before_eq_curr && !curr_eq_after) {
        // end of a sequence of repeats, mark with endMarker
        prefixPaddedInject[i][1] = prefix + endMarker;
      } else if (before_eq_curr && curr_eq_after) {
        // middle of a sequence of repeats, mark with contMarker
        prefixPaddedInject[i][1] = prefix + contMarker;
      } else if (!before_eq_curr && !curr_eq_after) {
        // lone line, mark with loneMarker
        prefixPaddedInject[i][1] = prefix + loneMarker;
      }

      // should not reach here
    }

    // prepare the final merged list of inlay hints and output them.
    const mergedRanges: [line: number, col: number, text: string][] = [
      ...prefixPaddedInject.map(
        ([line, text]) => [line, 0, text] satisfies [number, number, string],
      ),

      ...Object.entries(postfixInject).flatMap(([line, colText]) =>
        Object.entries(colText).map(
          ([col, text]) =>
            [+line, +col, text] satisfies [number, number, string],
        ),
      ),
    ];

    return mergedRanges.map(([line, col, text]) => {
      return {
        position: {
          line: line,
          character: col,
        },
        label: text,
        kind: InlayHintKind.Type,
      };
    });
  }
}
