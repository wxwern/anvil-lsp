import { TextDocument } from "vscode-languageserver-textdocument";
import { AnvilAst, AnvilAstNode } from "./ast/AnvilAst";
import { AnvilPosition, AnvilSpan } from "./ast/schema";
import { Range, Position, TextDocumentContentChangeEvent } from "vscode-languageserver";
import { AnvilCompilationResult, AnvilCompiler } from "./AnvilCompiler";
import { AnvilLspUtils } from "../utils/AnvilLspUtils";
import { AnvilServerSettings } from "../utils/AnvilServerSettings";
import fs from "fs";

export class AnvilDocument {
    private _textDocument: TextDocument | null = null;

    private _anvilAst: AnvilAst | null = null;
    private _anvilErrors: AnvilCompilationResult["errors"] | null = null;
    private _postAstTextEdited: ({add: Range} | {del: Range})[] = [];

    private readonly EXPERIMENTAL_TRACK_POST_AST_TEXT_EDITS = true;

    private constructor(doc: TextDocument, external: boolean = false) {
        this._textDocument = doc;
        this.textDocumentIsImported = external;
    }

    // Initialization

    /**
     * Creates an AnvilDocument from a given TextDocument.
     *
     * The AnvilDocument will treat the provided TextDocument as externally synced,
     * meaning that it expects the caller to keep the TextDocument up-to-date with
     * the actual text content.
     *
     * The caller is also responsible for calling {@link syncTextEdits} to inform
     * the AnvilDocument of any changes to the text content, allowing it to track edits
     * for AST code-span synchronization.
     *
     * @param doc The TextDocument instance to create the AnvilDocument from.
     * @returns A new AnvilDocument instance with the provided TextDocument.
     */
    static fromTextDocument(doc: TextDocument): AnvilDocument {
        return new AnvilDocument(doc, true);
    }

    /**
     * Creates an AnvilDocument from a file path.
     *
     * The AnvilDocument will read the file content and create an internal TextDocument instance.
     * This instance will not track any external changes to the file.
     *
     * @param filePath The path or URI to the file to create the AnvilDocument from.
     * @returns A new AnvilDocument instance with the content of the specified file,
     *          or null if the file cannot be accessed.
     */
    static fromFilesystem(filePath: string): AnvilDocument | null {
        if (filePath.startsWith('file://')) {
            filePath = filePath.replace('file://', '');
        }
        try {
            fs.accessSync(filePath);
            const data = fs.readFileSync(filePath, 'utf-8');
            return new AnvilDocument(
                TextDocument.create(`file://${filePath}`, 'anvil', 0, data),
                false
            );
        } catch (err) {
            return null;
        }
    }

    // Getters

    /** Indicates whether the text document is externally imported.
     *
     * If true, the {@link TextDocument} instance is provided externally and
     * is expected to be kept up-to-date by the caller with the actual text content.
     * The caller is also responsible for calling {@link syncTextEdits} to inform
     * the AnvilDocument of any changes to the text content, allowing it to track edits
     * for AST code-span synchronization.
     *
     * If false, the AnvilDocument manages its own {@link TextDocument} instance. It
     * does not synchronise with external changes and does not track any edits
     * or filesystem changes.
     */
    public readonly textDocumentIsImported: boolean;

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

    public get isResultsUpToDate(): boolean {
        return this._anvilAst !== null && this._postAstTextEdited.length === 0;
    }

    // Actions

    private _compileLock: Promise<boolean> | null = null;

    public async compile(settings: AnvilServerSettings): Promise<boolean> {
        if (this._compileLock) {
            const result = await this._compileLock;
            if (this.isResultsUpToDate) {
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

            const compiler = new AnvilCompiler(settings.projectRoot, settings.executablePath);

            // backup pre-compile state
            const prevAst = this._anvilAst;
            const prevHistory = this._postAstTextEdited;

            // reset AST cache at the moment of compilation
            this.resetAstCache();
            const result = await compiler.compile([filePath], fileData);

            // check for a new AST or to restore
            if (result.ast) {
                // success, update AST cache
                this._anvilAst = result.ast ?? null;
            } else {
                // failed, restore AST cache
                this._anvilAst = prevAst;
                this._postAstTextEdited = [...prevHistory, ...this._postAstTextEdited];
            }

            // update errors regardless of success, since they are relevant in both cases
            this._anvilErrors = result.errors ?? null;

            // release lock
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

    public getClosestIdentifierToLspPosition(position: Position): string | null {
        const document = this.textDocument;
        const l = position.line;
        let c = position.character;

        let characters = [];
        while (c > 0 && (characters.length === 0 || characters[characters.length - 1]?.match(/[a-zA-Z0-9_]/))) {
            c--;
            characters.push(document.getText({
                start: { line: l, character: c },
                end: { line: l, character: c + 1 }
            }));
        }
        characters.reverse();

        if (characters.length === 1 && characters[0].match(/[^a-zA-Z0-9_]/)) {
            characters = [];
        }

        c = position.character;
        while (characters.length === 0 || characters[characters.length - 1]?.match(/[a-zA-Z0-9_]/)) {
            characters.push(document.getText({
                start: { line: l, character: c },
                end: { line: l, character: c + 1 }
            }));
            c++;
        }

        if (characters.length === 0) {
            return null;
        }

        return characters.filter(x => x).filter(x => x?.match(/[a-zA-Z0-9_]/)).join('');
    }

    public getClosestAnvilNodeToLspPosition(position: Position): AnvilAstNode | null {
        if (!this._anvilAst) return null;

        const res = this.applyTrackedEditsOnPositionInstance(position, { reverse: true });
        if (!res.valid) return null;

        position = res.position;
        let anvilLoc = AnvilLspUtils.lspPosToAnvilPos(position);

        return this._anvilAst.closestNode(this.filepath, anvilLoc.line, anvilLoc.col);
    }

    public getLspPosOfAnvilPos(loc: AnvilPosition): Position | null {
        const position = AnvilLspUtils.anvilPosToLspPos(loc);
        const res = this.applyTrackedEditsOnPositionInstance(position, { reverse: false });
        if (!res.valid) return null;
        return res.position;
    }

    public getLspRangeOfAnvilSpan(span: AnvilSpan): Range | null {
        const range = AnvilLspUtils.anvilSpanToLspRange(span);
        const rs = this.applyTrackedEditsOnPositionInstance(range.start, { reverse: false });
        const re = this.applyTrackedEditsOnPositionInstance(range.end, { reverse: false });
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

    private applyTrackedEditsOnPositionInstance(position: Position, options: {reverse: boolean}): { position: Position, valid: boolean } {
        if (!this.EXPERIMENTAL_TRACK_POST_AST_TEXT_EDITS) return { position: position, valid: true };

        const reverse = options.reverse;

        position = { ...position }; // create a copy of the position to avoid mutating the original
        let valid = true;

        const edits = [...this._postAstTextEdited];
        if (reverse) {
            edits.reverse();
        }

        // reverse edits to get the original text in the span
        for (const edit of edits) {
            let r: Range;
            let add = false;
            let del = false;
            if ("add" in edit) {
                r = edit.add;
                add = true;
            } else if ("del" in edit) {
                r = edit.del;
                del = true;
            } else {
                continue; // should never happen
            }

            if (reverse ? add : del) {
                // need to delete the text segment
                if (AnvilLspUtils.posBeforePos(position, r.start)) {
                    // deletion is after --> we can ignore it since it doesn't move our text
                } else if (!AnvilLspUtils.posBeforePos(position, r.end)) {
                    // deletion is before  --> we need to move back by the length of the deleted text
                    const lineDiff = r.end.line - r.start.line;
                    if (lineDiff === 0) {
                        // single line change, just move character back if our current position is also on the same line
                        if (r.start.line === position.line) {
                            if (position.character >= r.end.character) {
                                position.character -= r.end.character - r.start.character;
                            } else if (position.character >= r.start.character) {
                                // our position is within the deleted text, this means it no longer exists in the original text
                                position.character = r.start.character;
                                valid = false;
                            } else {
                                // our position is before the deleted text, we can ignore it since it doesn't move our text
                            }
                        }
                    } else {
                        // multiple lines,
                        if (r.start.line < position.line) {
                            // only move lines if the deleted segment starts before the current position line
                            position.line -= lineDiff;
                        } else if (r.start.line === position.line) {
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

            if (reverse ? del : add) {
                // need to add back the text segment
                if (AnvilLspUtils.posBeforePos(r.start, position)) {
                    // addition is before --> need to move forward by the length of the deleted text
                    const lineDiff = r.end.line - r.start.line;
                    if (lineDiff === 0) {
                        // single line change, just move character forward if our current position is also on the same line
                        if (r.start.line === position.line) {
                            if (position.character >= r.start.character) {
                                position.character += r.end.character - r.start.character;
                            } else {
                                // our position is before the added text, we can ignore it since it doesn't move our text
                            }
                        }
                    } else {
                        // multiple lines,
                        if (r.start.line < position.line) {
                            // only move lines if the deleted segment starts before the position line
                            position.line += lineDiff;
                        } else if (r.start.line === position.line) {
                            // if the deleted segment starts on the same line as the position, we also need to move the character forward
                            position.character += r.end.character - r.start.character;
                        } else {
                            // addition is after the position line, we can ignore it since it doesn't move our text
                        }
                    }
                } else if (AnvilLspUtils.posBeforePos(position, r.start)) {
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
        this._anvilAst = null;
        this._anvilErrors = null;
        this._postAstTextEdited = [];
    }

}
