import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { AnvilDocument } from "./AnvilDocument";
import { AnvilLspUtils } from "./AnvilLspUtils";
import { AnvilAstNode } from "./AnvilAst";
import z from "zod";

export class AnvilDescriptionGenerator {

    public static DEBUG = false;
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
                range: AnvilLspUtils.anvilSpanToLspRange(error.span),
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
                            range: AnvilLspUtils.anvilSpanToLspRange(info.span)
                        },
                        message: `${mainMessage} (${info.message})`
                    });
                }
            } else {
                diagnostic.relatedInformation = [
                    {
                        location: {
                            uri: uri,
                            range: Object.assign({}, diagnostic.range)
                        },
                        message: mainMessage
                    }
                ];
            }

            diagnostics.push(diagnostic);
        }
        return diagnostics;
    }


    private static getTextForNode(
        node: AnvilAstNode,
        anvilDocument: AnvilDocument,
        supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null
    ): string {
        if (!node.span) {
            return "";
        }

        let bestDoc = anvilDocument;

        if (node.root === anvilDocument.anvilAst?.goToRoot(anvilDocument.filepath)) {
            // node is in the main document
            // we can use the main document for text retrieval
        } else {
            // attempt to find a supplementary document that contains the node
            const suppl = supplementaryDocuments?.(node);
            if (suppl) bestDoc = suppl;
        }

        return bestDoc.textDocument.getText(AnvilLspUtils.anvilSpanToLspRange(node.span!));
    }


    static nodeType(n: AnvilAstNode): string | null {
        const kind = n.traverse("kind").resolveAs(z.string());
        const type = n.traverse("type").resolveAs(z.string());
        switch (kind) {
            case "expr": return type ?? kind;
            default: return kind || "unknown";
        }
    }

    /**
     * Generates a short one-line hint for the given node, returning a markdown string that can be used in hover or other LSP features.
     */
    static async hintNode(
        node: AnvilAstNode,
        anvilDocument: AnvilDocument,
        supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null
    ): Promise<string> {

        const span = node.span;

        if (span) {
            const kind = this.nodeType(node);
            const defFullStr = this.getTextForNode(node, anvilDocument, supplementaryDocuments);
            if (defFullStr.trim().endsWith("}")) {
                // If the definition is a block, we want to trim it to just the signature for the hint
                const signatureMatch = defFullStr.match(/^[^{]*/);
                if (signatureMatch) {
                    return "```anvil\n"
                        + (kind ? `/* ${kind} */\n` : '')
                        + `${signatureMatch[0].trim()} { /* ... */ }\n`
                        + "```";
                }
            }

            let defLines = defFullStr.split("\n");

            let def = defLines[0].trim();
            if (def.length > 160) {
                def = def.substring(0, 160) + " /* ... */";
            } else if (defLines.length > 1) {
                def += " /* ... */";
            }

            return "```anvil\n"
                + (kind ? `/* ${kind} */\n` : '')
                + `${def}\n`
                + "```";;
        }
        return "";
    }

    /**
     * Describes the given node succintly, returning a markdown string that can be used in hover or other LSP features.
     */
    static async describeNode(
        node: AnvilAstNode,
        anvilDocument: AnvilDocument,
        supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null
    ): Promise<string> {

        let documentationSegment = "";
        let codeSegment = "";
        let definitionsSegment = "";
        let debugPathSegment = "";

        const kind = this.nodeType(node);

        const defFullStr = this.getTextForNode(node, anvilDocument, supplementaryDocuments);

        codeSegment = "```anvil\n"
            + (kind ? `/* ${kind} */\n` : '')
            + (defFullStr ? `${defFullStr}\n` : '')
            + "```\n";

        const defs = node.definitions;
        const defStrFormatter = (node: AnvilAstNode) => {
            if (defs.length > 1) {
                return this.hintNode(node, anvilDocument, supplementaryDocuments);
            } else {
                return this.describeNode(node, anvilDocument, supplementaryDocuments);
            }
        }

        const defStrs = await Promise.all(
            defs
            .map(def => anvilDocument.anvilAst?.goTo(def))
            .filter(def => def)
            .map(def => defStrFormatter(def!))
        );

        if (defStrs.length > 0) {
            definitionsSegment += "---\n**Definitions:**\n\n"
            definitionsSegment += defStrs.join("\n") + "\n";
        }

        if (this.DEBUG) {
            debugPathSegment += "---\n**DEBUG**\n"
            + `**- Node Path:** ${node.path.map(s => `\`${s}\``).join(".")}\n`
            + `**- Node Kind:** ${kind || "unknown"}\n`
            + `**- Node Span:** ${node.span ? `${node.span.start.line}:${node.span.start.col}-${node.span.end.line}:${node.span.end.col}` : "none"}\n`
            + `**- Node Defs:** ${node.definitions.length}\n`
            + "---\n"
            + "Raw Data:\n\n"
            + "```json\n"
            + JSON.stringify(node.resolve(), null, 2)
            + "\n```\n";
        }

        return codeSegment + documentationSegment + definitionsSegment + debugPathSegment;
    }

    /**
     * Explains the given node in detail, returning a markdown string that can be used in hover or other LSP features.
     */
    static async explainNode(
        node: AnvilAstNode,
        anvilDocument: AnvilDocument,
        supplementaryDocuments?: (f: AnvilAstNode) => AnvilDocument | null
    ): Promise<string> {
        return this.describeNode(node, anvilDocument, supplementaryDocuments);
    }
}
