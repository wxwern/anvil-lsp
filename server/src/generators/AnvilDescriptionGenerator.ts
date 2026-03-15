import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { AnvilDocument } from "../core/AnvilDocument";
import { AnvilLspUtils } from "../utils/AnvilLspUtils";
import { AnvilAstNode } from "../core/ast/AnvilAst";
import z from "zod";
import { astNodeInfo } from "../info/parsed";

export class AnvilDescriptionGenerator {

    private constructor() { }

    /**
     * Describes the diagnostics for a given AnvilDocument, converting them into LSP Diagnostics.
     */
    static async describeDiagnostics(anvilDocument: AnvilDocument, limit?: number): Promise<Diagnostic[]> {
        let problems = 0;

        const diagnostics: Diagnostic[] = [];
        const uri = anvilDocument.textDocument.uri;

        const result = { errors: anvilDocument.anvilErrors ?? [] }

        console.log("generating diagnostics for", uri, "with", result.errors.length, "errors");

        for (let error of result.errors) {
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
                        end: { line: 1, character: Number.MAX_VALUE }
                    },
                    message: `Dependency Errored at ${error.filepath}:${error.span.start.line}:${error.span.start.col}\n\n${error.message}`,
                    source: 'anvil'
                });
                continue;
            }

            const errorTypeString = {
                'warning': 'Warning',
                'error': 'Error'
            }

            const errorTypeDiagnosticSeverity = {
                'warning': DiagnosticSeverity.Warning,
                'error': DiagnosticSeverity.Error
            }

            const diagnostic: Diagnostic = {
                severity: errorTypeDiagnosticSeverity[error.type] || DiagnosticSeverity.Error,
                range:
                    anvilDocument.getLspRangeOfAnvilSpan(error.span) ??
                    AnvilLspUtils.anvilSpanToLspRange(error.span),
                message: error.message,
                source: 'anvil'
            };

            diagnostic.relatedInformation = [];

            const mainMessage = `Anvil Compiler ${errorTypeString[error.type] || 'Error'}`;

            if (error.supplementaryInfo) {
                for (let info of error.supplementaryInfo) {
                    diagnostic.relatedInformation.push({
                        location: {
                            uri: uri,
                            range:
                                anvilDocument.getLspRangeOfAnvilSpan(info.span) ??
                                AnvilLspUtils.anvilSpanToLspRange(info.span)
                        },
                        message: `${mainMessage} (${info.message})`
                    });
                }
            }

            diagnostics.push(diagnostic);
        }
        return diagnostics;
    }


    private static nodeType(n: AnvilAstNode): string | null {
        switch (n.kind) {
            case "expr": return n.type ?? "expr";
        }
        return n.kind;
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
        supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null
    ): { text: string, source: AnvilDocument } | null {
        if (!node.span) {
            return null;
        }

        let bestDoc = anvilDocument;

        if (node.filepath ===
            anvilDocument.anvilAst?.root(anvilDocument.filepath)?.filepath) {

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
                AnvilLspUtils.anvilSpanToLspRange(node.span!)
            ),
            source: bestDoc
        };
    }

    public static getNodeDefinitionStr(
        node: AnvilAstNode<any>,
        anvilDocument: AnvilDocument,
        supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null,
        options?: { expanded?: boolean | "auto" }
    ): string {
        const kind = this.nodeType(node);
        const kindStr = kind && node.isLabelled ? `/* ${this.nodeLabel(node)} */\n` : '';

        const span = node.span;

        if (span) {

            const _defRetrievedRawText = this.getTextForNode(node, anvilDocument, supplementaryDocuments);

            const defRawStr = _defRetrievedRawText?.text ?? "/* (definition lookup failed) */";
            const isSupplementary = _defRetrievedRawText?.source !== anvilDocument;

            const defLines = defRawStr.split('\n');

            let prefix = "";
            const nodeFilepath = node.absoluteSpan?.filepath;
            if (nodeFilepath && isSupplementary) {
                prefix = `/* ${nodeFilepath} */\n`;
            }

            // determine whether to expand the definition based on options and kind
            let expanded : boolean;
            let operOnly : boolean | string = false;

            if ((options?.expanded ?? "auto") === "auto") {
                switch (kind) {
                    case "channel_class_def":
                    case "type_def":
                    case "sig_def":
                    case "macro_def":
                    case "spawn_def":
                    case "channel_def":
                    case "message_def":
                    case "endpoint_def": {
                        expanded = true;
                        break;
                    }
                    case "wait":
                    case "join":
                    case "binop":
                    case "unop": {
                        operOnly = true;
                        // fallthrough
                    }
                    default: {
                        expanded = false;
                    }
                }
            } else {
                expanded = !!(options?.expanded);
            }

            // handle operator-only case
            if (operOnly) {
                switch (kind) {
                    case "unop":
                    case "binop": {
                        operOnly = `/* ${node.down("op").resolveAs(z.string()) || ""} */`;
                        break;
                    }
                    case "wait": {
                        operOnly = kindStr.trim() + " >>"
                        break;
                    }
                    case "join": {
                        operOnly = kindStr.trim() + " ;"
                        break;
                    }
                }

                if (typeof operOnly === "string") {
                    return operOnly + "\n";
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
                        return kindStr
                            + prefix
                            + `${signatureMatch[0].trim()} { /* ... */ }\n`
                    }
                }

                // If it's not a block, we can just return the first line
                return kindStr
                    + prefix
                    + `${defLines[0].trim()} `
                    + (defLines.length > 1 ? ' /* ... */\n' : '\n');
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

            const trimmedDefLines = defLines.map((line, i) => i ? line.substring(minIndentCount).trimEnd() : line.trimEnd());

            // return result
            return kindStr + prefix + trimmedDefLines.join('\n') + '\n';
        }

        return "";
    }

    /**
     * Generates a short one-line hint for the given node, returning a markdown string that can be used in hover or other LSP features.
     */
    static async hintNode(
        node: AnvilAstNode,
        anvilDocument: AnvilDocument,
        supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null,
    ): Promise<string> {

        const span = node.span;

        if (span) {
            return "```anvil\n"
                + this.getNodeDefinitionStr(node, anvilDocument, supplementaryDocuments, { expanded: false })
                + "```";;
        }
        return "";
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
            /** Explanations of the node */
            explanations?: boolean;
            /** Internal debug information (path, kind, span, raw JSON). */
            debug?: boolean;
        }
    ): string {

        let codeSegment = "";
        let documentationSegment = "";
        let definitionsSegment = "";
        let explanationSegment = "";
        let debugPathSegment = "";

        const kind = this.nodeType(node);

        // populate code segment
        if (segments?.code) {
            const defFullStr = this.getNodeDefinitionStr(node, anvilDocument, supplementaryDocuments, { expanded: "auto" });
            codeSegment = "```anvil\n" + defFullStr + "```\n";
        }

        // populate definitions segment
        if (segments?.definitions) {
            const defs = node.definitions;
            const defStrFormatter = (node: AnvilAstNode) => {
                return this.getNodeDefinitionStr(node, anvilDocument, supplementaryDocuments, { expanded: defs.length <= 1 ? "auto" : false });
            }

            const defStrs = (
                defs
                .map(def => anvilDocument.anvilAst?.node(def))
                .filter(def => def)
                .map(def => defStrFormatter(def!))
            );

            if (defStrs.length > 0) {
                if (segments?.code) {
                    definitionsSegment += "\n\n---\n\n"
                    definitionsSegment += "**Definitions:**\n\n";
                }

                definitionsSegment +=
                    "```anvil\n"
                    + defStrs.join("\n")
                    + "```\n";
            }
        }

        // populate explanation segment
        if (segments?.explanations) {
            const entry = astNodeInfo.getFor(node);

            if (entry && !entry.internal) {
                const hasAbove = !!(documentationSegment || codeSegment || definitionsSegment);
                const sep = hasAbove ? "\n\n---\n\n" : "";

                explanationSegment = sep + "**Information:**\n\n" + entry.description + "\n";
            }
        }

        // populate debug segment
        if (segments?.debug) {
            debugPathSegment += "\n\n---\n\n**DEBUG**\n\n"
            + `**- Node Path:** ${node.nodepath.map(s => `\`${s}\``).join(".")}\n`
            + `**- Node Kind:** ${kind || "unknown"}\n`
            + `**- Node Span:** ${node.span ? `${node.span.start.line}:${node.span.start.col}-${node.span.end.line}:${node.span.end.col}` : "none"}\n`
            + `**- Node Defs:** ${node.definitions.length}\n`
            + "\n---\n\n"
            + "Raw Data:\n\n"
            + "```json\n"
            + JSON.stringify(node.resolve(), null, 2)
            + "\n```\n";
        }

        return codeSegment + documentationSegment + definitionsSegment + explanationSegment + debugPathSegment;
    }

    /**
     * Explains the given node in detail, returning a markdown string that can be used in hover or other LSP features.
     */
    static async explainNode(
        node: AnvilAstNode,
        anvilDocument: AnvilDocument,
        supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null
    ): Promise<string> {
        return this.describeNode(node, anvilDocument, supplementaryDocuments, {
            code: true,
            documentation: true,
            definitions: true,
        });
    }
}
