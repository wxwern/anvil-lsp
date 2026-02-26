import { TextDocument } from "vscode-languageserver-textdocument";
import { AnvilAst, AnvilAstNode, AnvilSpan, AnvilPos } from "./AnvilAst";
import { Range, Position, TextDocumentContentChangeEvent } from "vscode-languageserver";
import { AnvilCompilationResult, AnvilCompiler } from "./AnvilCompiler";
import { AnvilLspUtils, AnvilServerSettings } from "./AnvilLspUtils";

export class AnvilDocument {
    private _textDocument: TextDocument | null = null;

    private _anvilSettings: AnvilServerSettings | null = null;
    private _anvilAst: AnvilAst | null = null;
    private _anvilErrors: AnvilCompilationResult["errors"] | null = null;
    private _postAstTextEdited: ({add: Range} | {del: Range})[] = [];

    private readonly EXPERIMENTAL_TRACK_POST_AST_TEXT_EDITS = true;

    private constructor(doc: TextDocument) {
        this._textDocument = doc;
    }

    static fromTextDocument(doc: TextDocument): AnvilDocument {
        return new AnvilDocument(doc);
    }

    // Getters
    public get textDocument(): TextDocument {
        if (!this._textDocument) {
            throw new Error("Text document not loaded");
        }
        return this._textDocument;
    }

    public get filepath(): string {
        return this.textDocument.uri.replace('file://', '');
    }

    public get anvilAst(): AnvilAst | null {
        return this._anvilAst;
    }

    public get anvilErrors(): AnvilCompilationResult["errors"] | null {
        return this._anvilErrors;
    }

    public get anvilResultsUpToDate(): boolean {
        return this._anvilAst !== null && this._postAstTextEdited.length === 0;
    }

    public get anvilLastCompileLspSettings(): AnvilServerSettings | null {
        return this._anvilSettings;
    }

    // Actions

    private _compileLock: Promise<boolean> | null = null;

    public async compile(settings: AnvilServerSettings): Promise<boolean> {
        if (this._compileLock) {
            const result = await this._compileLock;
            if (this.anvilResultsUpToDate && AnvilLspUtils.settingsEqual(this._anvilSettings ?? {}, settings)) {
                return result;
            }
            // otherwise, we need to recompile to update the AST and clear the post-AST edits
        }

        this._compileLock = (async () => {
            if (!this._textDocument) {
                return false;
            }

            const filePath = this._textDocument.uri.replace('file://', '');
            const fileData = { [filePath]: this._textDocument.getText() };

            const compiler = new AnvilCompiler(settings.executablePath, settings.projectRoot);

            this.resetAstCache();
            const result = await compiler.compile([filePath], fileData);

            this._anvilSettings = settings;
            if (result.ast) {
                this._anvilAst = result.ast ?? null;
            }

            this._anvilErrors = result.errors ?? null;
            this._compileLock = null;
            return !!result.ast;
        })();

        return this._compileLock;
    }

    private _compileDebounceFireHandlers: (() => Promise<unknown>)[] = [];
    private _compileDebounceTimer: NodeJS.Timeout | null = null;

    public async scheduleCompileDebounced(settings: AnvilServerSettings, debounceTime: number = 500) {
        return new Promise<void>(resolve => {
            if (this._compileDebounceTimer) {
                clearTimeout(this._compileDebounceTimer);
            }

            this._compileDebounceFireHandlers.push(async () => resolve());

            this._compileDebounceTimer = setTimeout(() => {
                const handlers = this._compileDebounceFireHandlers;

                this._compileDebounceFireHandlers = [];

                this.compile(settings).finally(() => {
                    handlers.map(h => h());
                });
            }, debounceTime);
        });
    }

    // Locators

    public textInLspRange(range: Range): string {
        return this.textDocument.getText(range);
    }

    public textInAnvilSpan(span: AnvilSpan): string {
        const lspRange = this.getLspRangeOfAnvilSpan(span);
        if (!lspRange) return "";
        return this.textInLspRange(lspRange);
    }

    public getClosestAnvilNodeToLspPosition(position: Position): AnvilAstNode | null {
        if (!this._anvilAst) return null;

        const res = this.reverseTrackedEditsOnPositionInstance(position);
        if (!res.valid) return null;

        position = res.position;
        let anvilLoc = AnvilLspUtils.lspLocToAnvilLoc(position);

        return this._anvilAst.goToClosest(this.filepath, anvilLoc.line, anvilLoc.col);
    }

    public getLspLocOfAnvilLoc(loc: AnvilPos): Position | null {
        const position = AnvilLspUtils.anvilLocToLspLoc(loc);
        const res = this.reverseTrackedEditsOnPositionInstance(position);
        if (!res.valid) return null;
        return res.position;
    }

    public getLspRangeOfAnvilSpan(span: AnvilSpan): Range | null {
        const range = AnvilLspUtils.anvilSpanToLspRange(span);
        const rs = this.reverseTrackedEditsOnPositionInstance(range.start);
        const re = this.reverseTrackedEditsOnPositionInstance(range.end);
        if (!rs.valid || !re.valid) {
            return null;
        }
        return { start: rs.position, end: re.position };
    }

    // Synchronization

    public syncTextEdits(contentChanges: TextDocumentContentChangeEvent[]): void {

        if (!this.EXPERIMENTAL_TRACK_POST_AST_TEXT_EDITS) {
            // any edit will be invalidated - reset everything
            this.resetAstCache();
            return;
        }

        for (const change of contentChanges) {
            if ("range" in change) {
                // this is a text edit, we need to track it for the AST synchronization
                const range = change.range

                if (change.range.start.line !== change.range.end.line || change.range.start.character !== change.range.end.character) {
                    // there is some removed text
                    this.removeTextInLspRange(range);
                }

                if (change.text.length > 0) {
                    // there exists some new text
                    const newTextLines = change.text.split('\n');
                    const addedRange: Range = {
                        start: range.start,
                        end: {
                            line: range.start.line + newTextLines.length - 1,
                            character: newTextLines.length === 1 ? range.start.character + change.text.length : newTextLines[newTextLines.length - 1].length
                        }
                    };
                    this.addTextInLspRange(addedRange);
                }

            } else {
                // this is a full document replacement
                // we have no tracking mechanism for this, so we need to reset everything
                this.resetAstCache();
            }
        }
    }

    // Internal Utils

    private reverseTrackedEditsOnPositionInstance(position: Position): { position: Position, valid: boolean } {
        if (!this.EXPERIMENTAL_TRACK_POST_AST_TEXT_EDITS) return { position: position, valid: true };

        position = { ...position }; // create a copy of the position to avoid mutating the original
        let valid = true;

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
                if (AnvilLspUtils.posBeforePos(position, r.start)) {
                    // deletion is after --> we can ignore it since it doesn't move our text
                } else if (AnvilLspUtils.posBeforePos(r.end, position)) {
                    // deletion is before  --> we need to move back by the length of the added text
                    const lineDiff = r.end.line - r.start.line;
                    if (lineDiff === 0) {
                        // same line, just move character back
                        position.character -= r.end.character - r.start.character;
                    } else {
                        // multiple lines,
                        if (r.start.line < position.line) {
                            // only move lines if the added segment starts before the position line
                            position.line -= lineDiff;
                        } else {
                            // if the added segment starts on the same line as the position, we also need to move the character back
                            position.character -= r.end.character - r.start.character;
                        }
                    }
                } else {
                    // deletion surrounds --> need to delete the entire segment
                    // this means our position will no longer exist in the original text
                    position.line = r.start.line;
                    position.character = r.start.character;
                    valid = false;
                }
            }

            if (del) {
                // need to add back the deleted text segment
                if (AnvilLspUtils.posBeforePos(position, r.start)) {
                    // addition is before --> need to move forward by the length of the deleted text
                    const lineDiff = r.end.line - r.start.line;
                    if (lineDiff === 0) {
                        // same line, just move character forward
                        position.character += r.end.character - r.start.character;
                    } else {
                        // multiple lines,
                        if (r.start.line < position.line) {
                            // only move lines if the deleted segment starts before the position line
                            position.line += lineDiff;
                        } else {
                            // if the deleted segment starts on the same line as the position, we also need to move the character forward
                            position.character += r.end.character - r.start.character;
                        }
                    }
                } else if (AnvilLspUtils.posBeforePos(r.start, position)) {
                    // addition is after  --> we can ignore it since it doesn't move our text
                } else {
                    // addition is exactly at the position --> we can ignore it since it doesn't move our text
                }
            }
        }
        return { position: position, valid: valid };
    }

    private addTextInLspRange(range: Range) {
        this._postAstTextEdited.push({ add: range });
    }

    private removeTextInLspRange(range: Range) {
        this._postAstTextEdited.push({ del: range });
    }

    private resetAstCache() {
        this._anvilSettings = null;
        this._anvilAst = null;
        this._anvilErrors = null;
        this._postAstTextEdited = [];
    }

}
