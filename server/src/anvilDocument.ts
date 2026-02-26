
import { TextDocument } from "vscode-languageserver-textdocument";
import { AnvilAst, AnvilSpan } from "./anvilAst";
import { Range, Position } from "vscode-languageserver";

class AnvilLspUtils {
    static anvilLocToLspLoc(loc: AnvilSpan["start"]): Position {
        return {
            line: loc.line - 1,
            character: loc.col
        };
    }

    static anvilSpanToLspRange(span: AnvilSpan): Range {
        return {
            start: this.anvilLocToLspLoc(span.start),
            end: this.anvilLocToLspLoc(span.end)
        };
    }

    static lspLocToAnvilLoc(loc: Position): AnvilSpan["start"] {
        return {
            line: loc.line + 1,
            col: loc.character
        };
    }

    static lspRangeToAnvilSpan(range: Range): AnvilSpan {
        return {
            start: this.lspLocToAnvilLoc(range.start),
            end: this.lspLocToAnvilLoc(range.end)
        };
    }

    static rangesOverlap(range1: Range, range2: Range): boolean {
        return range1.start.line < range2.end.line ||
            (range1.start.line === range2.end.line && range1.start.character < range2.end.character) ||
            range1.end.line > range2.start.line ||
            (range1.end.line === range2.start.line && range1.end.character > range2.start.character);
    }

    static rangeContains(outer: Range, inner: Range): boolean {
        return (outer.start.line < inner.start.line || (outer.start.line === inner.start.line && outer.start.character <= inner.start.character)) &&
            (outer.end.line > inner.end.line || (outer.end.line === inner.end.line && outer.end.character >= inner.end.character));
    }
}

class AnvilDocument {

    private _textDocument: TextDocument | null = null;

    private _postAstTextEdited: ({add: Range} | {del: Range})[] = [];
    private _anvilAst: AnvilAst | null = null;

    private readonly EXPERIMENTAL_TRACK_POST_AST_TEXT_EDITS = false;

    private constructor(doc: TextDocument) {
        this._textDocument = doc;
    }

    static fromTextDocument(doc: TextDocument): AnvilDocument {
        return new AnvilDocument(doc);
    }

    public get textDocument(): TextDocument {
        if (!this._textDocument) {
            throw new Error("Text document not loaded");
        }
        return this._textDocument;
    }

    public textInLspRange(range: Range): string {
        return this.textDocument.getText(range);
    }

    public textInAnvilSpan(span: AnvilSpan): string {
        const range = AnvilLspUtils.anvilSpanToLspRange(span);
        this.reverseTrackedEditsOnRangeInstance(range);
        return this.textInLspRange(range);
    }

    public get anvilAst(): AnvilAst | null {
        return this._anvilAst;
    }

    public set anvilAst(ast: AnvilAst | null) {
        this._anvilAst = ast;
        this._postAstTextEdited = [];
    }





    private reverseTrackedEditsOnRangeInstance(range: Range) {
        if (!this.EXPERIMENTAL_TRACK_POST_AST_TEXT_EDITS) return;

        // reverse edits to get the original text in the span
        for (const edit of this._postAstTextEdited.toReversed()) {
            let r: Range;
            if ("add" in edit) {
                r = edit.add;
            } else {
                r = edit.del;
            }
            const add = "add" in edit;
            const del = "del" in edit;

            if (add) {
                // need to delete the added text segment
                if (!AnvilLspUtils.rangesOverlap(r, range)) {
                    // before --> shift range back
                    if (r.start.line < range.end.line || (r.start.line === range.end.line && r.start.character <= range.end.character)) {
                        const lineShift = r.end.line - r.start.line;
                        const charShift = r.end.character - r.start.character;
                        range.end.line -= lineShift;
                        range.end.character -= charShift;
                    }
                    if (r.start.line < range.start.line || (r.start.line === range.start.line && r.start.character <= range.start.character)) {
                        const lineShift = r.end.line - r.start.line;
                        const charShift = r.end.character - r.start.character;
                        range.start.line -= lineShift;
                        range.start.character -= charShift;
                    }
                }

                // inside --> split range
                if (AnvilLspUtils.rangeContains(r, range)) {
                    // split into two ranges and return the first part
                    const lRange: Range = {
                        start: r.start,
                        end: range.start
                    };
                    const rRange: Range = {
                        start: range.end,
                        end: r.end
                    };
                    range.start = lRange.start;
                    range.end = lRange.end;
                }

                if (AnvilLspUtils.rangeContains(range, r)) {
                    // added text is fully inside the range, need to expand the range to include it
                    const lineShift = r.end.line - r.start.line;
                    const charShift = r.end.character - r.start.character;
                    range.end.line += lineShift;
                    range.end.character += charShift;
                }

                // after --> no change
            }

            if (del) {
                // need to add back the deleted text segment
                if (!AnvilLspUtils.rangesOverlap(r, range)) {
                    // before --> shift range forward
                    if (r.start.line < range.end.line || (r.start.line === range.end.line && r.start.character <= range.end.character)) {
                        const lineShift = r.end.line - r.start.line;
                        const charShift = r.end.character - r.start.character;
                        range.end.line += lineShift;
                        range.end.character += charShift;
                    }
                    if (r.start.line < range.start.line || (r.start.line === range.start.line && r.start.character <= range.start.character)) {
                        const lineShift = r.end.line - r.start.line;
                        const charShift = r.end.character - r.start.character;
                        range.start.line += lineShift;
                        range.start.character += charShift;
                    }
                }

                // inside --> split range
                if (AnvilLspUtils.rangeContains(r, range)) {
                    // split into two ranges and return the first part
                    const lRange: Range = {
                        start: r.start,
                        end: range.start
                    };
                    const rRange: Range = {
                        start: range.end,
                        end: r.end
                    };
                    range.start = lRange.start;
                    range.end = lRange.end;
                }
                if (AnvilLspUtils.rangeContains(range, r)) {
                    // deleted text is fully inside the range, need to shrink the range to exclude it
                    const lineShift = r.end.line - r.start.line;
                    const charShift = r.end.character - r.start.character;
                    range.end.line -= lineShift;
                    range.end.character -= charShift;
                }

                // after --> no change
            }
        }
    }

    private addTextInLspRange(range: Range) {
        this._postAstTextEdited.push({ add: range });
    }

    private removeTextInLspRange(range: Range) {
        this._postAstTextEdited.push({ del: range });
    }

    private reload() {
        this._anvilAst = null;
        this._postAstTextEdited = [];
    }

}