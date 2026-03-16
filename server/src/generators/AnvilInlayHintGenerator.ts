import { InlayHint, InlayHintKind } from "vscode-languageserver";
import { AnvilServerSettings, resolveTimingInfo } from "../utils/AnvilServerSettings";
import { AnvilLspUtils } from "../utils/AnvilLspUtils";
import { inlayHintLogger } from "../utils/logger";
import { AnvilDocument } from "../core/AnvilDocument";
import { AnvilEventInfo } from "../core/ast/AnvilAst";


export class AnvilInlayHintGenerator {

  /**
   * Generates inlay hints for the given Anvil document based on the provided server settings.
   */
  public static generateInlayHints(anvilDocument: AnvilDocument, settings: AnvilServerSettings): InlayHint[] {
    const hints: InlayHint[] = [];

	const timingHints = resolveTimingInfo(settings.showTimingInfo);
	if (timingHints.asInlayHints !== "none") {
		hints.push(...this.computeLifetimeInlayHints(anvilDocument, { mode: timingHints.asInlayHints, debug: settings.debug }));
	}

    return hints;
  }

  /**
   * Computes inlay hints related to event cycles and lifetimes in the Anvil document, and returns them as InlayHint objects.
   */
  private static computeLifetimeInlayHints(anvilDocument: AnvilDocument, options: { mode: 'condensed' | 'full', debug?: boolean }): InlayHint[] {
    if (!anvilDocument.anvilAst) {
		inlayHintLogger.info(`No inlay hint info available for document ${anvilDocument.filepath}`);
		return [];
	}

	const ascii = false;

	const lineCount = anvilDocument.textDocument.lineCount;

	const locs = anvilDocument.anvilAst.getAllLocatableNodes(anvilDocument.filepath);

	let prefixInject: {[lineno: number]: string} = [];
	let postfixInject: {[lineno: number]: string} = [];
	let maxTextLen = 0;
	const markerLen = 3;
	const formatEvent = (e: AnvilEventInfo | null) => {
		if (e === null) return null;

		const eid = e.eid;
		const tid = e.tid;
		const delays = e.delays;

		const debugEid = options.debug ? ` (e${eid})` : '';
		const delayStr = delays ? `t${tid} c` + delays.map(d => '' + d).join('/') + debugEid : '';

		return delayStr || `t${tid} c?${debugEid}`;
	}

    // iterate through all locatable nodes, and find and record their event information.
	for (let loc of locs) {
		const node = anvilDocument.anvilAst?.node(loc);
		if (!node) continue;
		const event = formatEvent(node.event);
		const susTillEv = formatEvent(node.sustainedTillEvent);
		if (!event) continue;

		const lspStartLine =
			anvilDocument.getLspPosOfAnvilPos({ line: loc.span.start.line, col: 0 })?.line ??
			AnvilLspUtils.anvilPosToLspPos(loc.span.start).line;

		const lspEndLine =
			anvilDocument.getLspPosOfAnvilPos({ line: loc.span.end.line, col: 0 })?.line ??
			AnvilLspUtils.anvilPosToLspPos(loc.span.end).line;

        // prefix: indicate event cycle info
		for (let l = lspStartLine; l <= lspEndLine; l++) {
			// Assumption: locs are discovered pre-order
			//  - Inner nodes will override outer nodes if they share the same line,
			//    which is desirable for better specificity of inlay hints
			prefixInject[l] = event;
		}

        // postfix: indicate sustained till event info, if applicable
		const sustainSymbol = ascii ? '~>' : '⚡→';
		postfixInject[lspEndLine] = susTillEv ?
			(options.mode === "full" ? ` ... sustained till ${susTillEv} ends` : `  ${sustainSymbol} ${susTillEv}`) :
			'';

        // track max length for alignment purposes later
        maxTextLen = Math.max(maxTextLen, event.length);
	}

	maxTextLen = Math.max(8, Math.pow(2, Math.ceil(Math.log2(maxTextLen + markerLen))));

	inlayHintLogger.info(`Found lifetime inlay hints (${Object.keys(prefixInject).length} (prefix) + ${Object.keys(postfixInject).length} (postfix)) for document ${anvilDocument.filepath}`);

    // pad the prefix event information to be identical length for all lines.
	const inlineRanges: [number, string][] = [];
	for (let line = 0; line < lineCount; line++) {
		if (prefixInject[line]) {
			const text = prefixInject[line];
			if (text.length < maxTextLen) {
				// pad with spaces to ensure inlay hints are aligned
				inlineRanges.push([line, ' '.repeat(maxTextLen - text.length - markerLen) + text]);
			} else {
				inlineRanges.push([line, text]);
			}
		} else {
			inlineRanges.push([line, ' '.repeat(maxTextLen - markerLen)]);
		}
	}

	// merge all prefix lines with the same event cycle into a single block with markers to indicate continuation
	const loneMarker  = (ascii ? ' - ' : ' ─ ');
	const startMarker = (ascii ? ',- ' : ' ┌ ');
	const contMarker  = (ascii ? '|  ' : ' │ ');
	const endMarker   = (ascii ? "'- " : ' └ ');

	let repeats_above: {[i: number]: boolean} = {};

    // - first pass: determine which lines have the same event cycle as the line above, and record in repeats_above
	let lastText = '';
	for (let i = 0; i < inlineRanges.length; i++) {
		let currText = inlineRanges[i][1].trim();
		if (options.debug) {
			currText = currText.replace(/\(e\d+\)/g, '(eX)');
		}

		repeats_above[i] = currText === lastText;
		if (currText) {
			lastText = currText;
		}
	}

    // - second pass: use the information in repeats_above to determine which marker to append to each line,
    //                and replace the text with spaces if it's a repeat of the line above
	for (let i = 0; i < inlineRanges.length; i++) {
		const currText = inlineRanges[i][1].trim();
		if (!currText) {
			inlineRanges[i][1] = ' '.repeat(maxTextLen);
			continue;
		}

		const before_is_blank = inlineRanges[i - 1]?.[1].trim() === '';

		const before_eq_curr = repeats_above[i];
		const curr_eq_after = repeats_above[i + 1];

		if (before_is_blank && before_eq_curr) {
			// search upwards till we find a non-blank line
			let j = i - 1;
			while (j >= 0 && inlineRanges[j][1].trim() === '') {
				j--;
			}
			if (j >= 0) {
				const wasLone = inlineRanges[j][1].endsWith(loneMarker);
				const wasEnd = inlineRanges[j][1].endsWith(endMarker);
				if (wasLone) {
					inlineRanges[j][1] =
						inlineRanges[j][1].slice(0, -loneMarker.length) +
						startMarker;
				} else if (wasEnd) {
					inlineRanges[j][1] =
						inlineRanges[j][1].slice(0, -endMarker.length) +
						contMarker;
				}
			}
			// replace forwards with contMarker
			j += 1;
			while (j < i) {
				inlineRanges[j][1] =
					' '.repeat(maxTextLen - markerLen) +
					contMarker;
				j++;
			}
		}

		const prefix = options.debug || !before_eq_curr ? inlineRanges[i][1] : ' '.repeat(maxTextLen - markerLen);

		if (!before_eq_curr && curr_eq_after) {
			// start of a new sequence of repeats, mark with startMarker
			inlineRanges[i][1] = prefix + startMarker;
		} else if (before_eq_curr && !curr_eq_after) {
			// end of a sequence of repeats, mark with endMarker
			inlineRanges[i][1] = prefix + endMarker;
		} else if (before_eq_curr && curr_eq_after) {
			// middle of a sequence of repeats, mark with contMarker
			inlineRanges[i][1] = prefix + contMarker;
		} else if (!before_eq_curr && !curr_eq_after) {
			// lone line, mark with loneMarker
			inlineRanges[i][1] = prefix + loneMarker;
		}

		// should not reach here
	}

    // prepare the final merged list of inlay hints and output them.
	const mergedRanges: [line: number, col: number, text: string][] =
	[
		...inlineRanges
			.map(([line, text]) =>
				 [line, 0, text] as [number, number, string]),

		...Object.entries(postfixInject)
			.map(([line, text]) =>
				 [+line, Infinity, text] as [number, number, string])
	];

	let calcPostfixPosition = (line: number) => {
		const lineText = anvilDocument.textDocument.getText({
			start: { line, character: 0 },
			end: { line, character: Number.MAX_SAFE_INTEGER }
		});
		return lineText.length;
	}

	return mergedRanges.map(([line, col, text]) => {
		let pos = {
			line: line,
			character: col
		};

		if (!Number.isFinite(pos?.character ?? 0)) {
			pos!.character = calcPostfixPosition(pos!.line);
		}

		return {
			position: pos,
			label: text,
			kind: InlayHintKind.Type
		}
	});
  }
}
