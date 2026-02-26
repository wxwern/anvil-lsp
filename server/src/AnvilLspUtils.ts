import { Position, Range } from "vscode-languageserver";
import { AnvilPos, AnvilSpan } from "./AnvilAst";

export interface AnvilServerSettings {
    maxNumberOfProblems: number;
    projectRoot?: string;
    executablePath?: string;
    debug?: boolean;
}

export const DEFAULT_ANVIL_SERVER_SETTINGS: AnvilServerSettings = { maxNumberOfProblems: 1000 };

export class AnvilLspUtils {

    private constructor() { }

    static anvilLocToLspLoc(loc: AnvilPos): Position {
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

    static lspLocToAnvilLoc(loc: Position): AnvilPos {
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

    static posInRange(pos: Position, range: Range): boolean {
        return (pos.line > range.start.line || (pos.line === range.start.line && pos.character >= range.start.character)) &&
            (pos.line < range.end.line || (pos.line === range.end.line && pos.character <= range.end.character));
    }

    static posBeforePos(pos1: Position, pos2: Position): boolean {
        return pos1.line < pos2.line || (pos1.line === pos2.line && pos1.character < pos2.character);
    }

    static posEqual(pos1: Position, pos2: Position): boolean {
        return pos1.line === pos2.line && pos1.character === pos2.character;
    }

    static settingsEqual(settings1: Partial<AnvilServerSettings>, settings2: Partial<AnvilServerSettings>): boolean {
        const deepEqual = (obj1: any, obj2: any): boolean => {
            if (obj1 === obj2) return true;
            if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) {
                return false;
            }
            const keys1 = Object.keys(obj1);
            const keys2 = Object.keys(obj2);
            keys1.sort();
            keys2.sort();
            if (keys1.length !== keys2.length) return false;
            for (let i = 0; i < keys1.length; i++) {
                if (keys1[i] !== keys2[i]) return false;
                if (!deepEqual(obj1[keys1[i]], obj2[keys2[i]])) return false;
            }
            return true;
        };
        return deepEqual(settings1, settings2);
    }
}
