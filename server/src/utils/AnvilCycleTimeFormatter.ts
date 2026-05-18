import {
  AnvilCycleTime,
  AnvilCycleTimeTerm,
  type AnvilEventExpr,
} from '../core/ast/schema';

export type AnvilCycleTimeExpressionLookup = Record<string, AnvilEventExpr>;

export interface FormatCycleTimeDefinitionOptions extends FormatCycleTimeOptions {
  includeUnknowns?: boolean;
}

/**
 * Options for formatting AnvilCycleTime objects.
 */
export interface FormatCycleTimeOptions {
  /**
   * Maximum length of the formatted string before truncation.
   * If the formatted string exceeds this length, it will be truncated with ellipsis.
   */
  maxLength?: number;

  /**
   * Whether to output in compact space-saving format (e.g., "n1+n2+5" instead of "n1 + n2 + 5").
   */
  compact?: boolean;

  /**
   * Whether to use ASCII characters instead of Unicode symbols.
   */
  ascii?: boolean;

  /**
   * Whether to include parentheses around the entire expression when there are multiple terms.
   */
  parenthesize?: boolean;
}

function compareSymbols(a: string, b: string): number {
  const aIsGenerated = /^(or|max)\d+$/.test(a);
  const bIsGenerated = /^(or|max)\d+$/.test(b);

  if (aIsGenerated !== bIsGenerated) {
    return aIsGenerated ? 1 : -1;
  }

  const pattern = /^(.*?)(\d+)?$/;
  const aMatch = a.match(pattern);
  const bMatch = b.match(pattern);

  if (!aMatch || !bMatch) {
    return a.localeCompare(b);
  }

  const aBase = aMatch[1];
  const aNum = aMatch[2] ? parseInt(aMatch[2], 10) : 0;
  const bBase = bMatch[1];
  const bNum = bMatch[2] ? parseInt(bMatch[2], 10) : 0;

  if (aBase === bBase) {
    return aNum - bNum;
  }

  return aBase.localeCompare(bBase);
}

function compareTerm(a: AnvilCycleTimeTerm, b: AnvilCycleTimeTerm): number {
  const aIsConst = a.const !== undefined;
  const bIsConst = b.const !== undefined;

  if (!aIsConst && bIsConst) return -1;
  if (aIsConst && !bIsConst) return 1;

  if (a.sym !== undefined && b.sym !== undefined) {
    return compareSymbols(a.sym, b.sym);
  }

  return 0;
}

function compareCycleTimes(a: AnvilCycleTime, b: AnvilCycleTime): number {
  if (Math.min(a.length, b.length) === 0) {
    return a.length - b.length; // Empty comes first
  }

  // get first sym term from each cycle time
  const aFirstSym = a[0];
  const bFirstSym = b[0];

  if (aFirstSym?.sym !== undefined && bFirstSym?.sym !== undefined) {
    const diff = compareTerm(aFirstSym, bFirstSym);
    if (diff !== 0) {
      return diff; // Sort by first symbolic term if both have one and they are different
    }
  }

  return a.length - b.length; // Otherwise sort by length
}

/**
 * Formats a single AnvilCycleTimeTerm into a string.
 *
 * @param term The term to format
 * @param ascii Whether to use ASCII characters
 * @param compact Whether to use compact formatting
 * @param parenthesize Whether to include parentheses around sub-expressions
 * @returns Formatted string representation
 */
function formatTerm(term: AnvilCycleTimeTerm): string {
  if (term.const !== undefined) {
    return term.const.toString();
  }

  if (term.sym !== undefined) {
    return term.sym;
  }

  return '?';
}

function formatChoiceBranch(
  cycleTime: AnvilCycleTime,
  options: FormatCycleTimeOptions = {},
): string {
  return formatCycleTime(cycleTime, {
    ...options,
    parenthesize: cycleTime.length > 1,
  });
}

function formatEventExprExpression(
  expr: AnvilEventExpr,
  options: FormatCycleTimeOptions = {},
): string {
  const branches = expr.value
    .map((sum) => [...sum].sort(compareTerm))
    .sort(compareCycleTimes)
    .map((sum) => formatChoiceBranch(sum, options));

  if (expr.type === 'or') {
    return branches.join(options.compact ? '/' : ' / ');
  }

  return `max(${branches.join(', ')})`;
}

function collectCycleTimeDefinitionLines(
  cycleTime: AnvilCycleTime,
  lookup: AnvilCycleTimeExpressionLookup,
  visited: Set<string>,
  unknownSymbols: Set<string>,
  definitions: string[],
  options: FormatCycleTimeOptions,
): void {
  for (const term of cycleTime) {
    if (term.sym === undefined) {
      continue;
    }

    const expr = lookup[term.sym];
    if (!expr) {
      unknownSymbols.add(term.sym);
      continue;
    }

    if (visited.has(term.sym)) {
      continue;
    }

    visited.add(term.sym);
    unknownSymbols.delete(term.sym);
    definitions.push(
      `${term.sym} = ${formatEventExprExpression(expr, options)}`,
    );

    for (const branch of expr.value) {
      collectCycleTimeDefinitionLines(
        branch,
        lookup,
        visited,
        unknownSymbols,
        definitions,
        options,
      );
    }
  }
}

export function formatCycleTimeDefinitions(
  cycleTime: AnvilCycleTime,
  lookup: AnvilCycleTimeExpressionLookup,
  options: FormatCycleTimeDefinitionOptions = {},
): string[] {
  return formatCycleTimeDefinitionsForAll([cycleTime], lookup, options);
}

export function formatCycleTimeDefinitionsForAll(
  cycleTimes: AnvilCycleTime[],
  lookup: AnvilCycleTimeExpressionLookup,
  options: FormatCycleTimeDefinitionOptions = {},
): string[] {
  const definitions: string[] = [];
  const unknownSymbols = new Set<string>();
  const visited = new Set<string>();

  for (const cycleTime of cycleTimes) {
    collectCycleTimeDefinitionLines(
      cycleTime,
      lookup,
      visited,
      unknownSymbols,
      definitions,
      options,
    );
  }

  const sortedDefinitions = definitions.sort((a, b) => compareSymbols(a, b));
  const sortedUnknowns = [...unknownSymbols].sort(compareSymbols);

  if (options.includeUnknowns !== false && sortedUnknowns.length > 0) {
    sortedDefinitions.push(`${sortedUnknowns.join(', ')} = ?`);
  }

  return sortedDefinitions;
}

/**
 * Formats an AnvilCycleTime (array of terms) into a human-readable string representation.
 *
 * The AnvilCycleTime is an array of terms that are summed together.
 * Each term can be:
 * - A constant: { const: number } -> "5"
 * - A symbolic variable: { sym: string } -> "n1"
 * - A max operation: { sym: string, max: AnvilCycleTime[] } -> "max{a, b, c}"
 * - An or operation: { or: AnvilCycleTime[] } -> "(a/b/c)"
 *
 * Example: [{ const: 1 }, { or: [[{ const: 5 }], [{ sym: "n1" }]] }, { sym: "max1", max: [...] }]
 * Formats to: "1 + (5/n1) + max{...}"
 *
 * @param cycleTime The AnvilCycleTime array to format
 * @param options Formatting options
 * @returns A formatted string representation of the cycle time
 */
export function formatCycleTime(
  cycleTime: AnvilCycleTime,
  options: FormatCycleTimeOptions = {},
): string {
  const {
    maxLength,
    ascii = false,
    compact = false,
    parenthesize = false,
  } = options;

  if (cycleTime.length === 0) {
    return '0';
  }

  const ellipsis = ascii ? '......' : '……';

  let constTerm = 0;
  const symTerms: AnvilCycleTimeTerm[] = [];

  for (const term of cycleTime) {
    if (term.const !== undefined) {
      constTerm += term.const;
    } else {
      symTerms.push(term);
    }
  }

  if (symTerms.length === 0) {
    return constTerm.toString();
  }

  // Sort terms: symbolic variables first, then max/or terms, then constants
  symTerms.sort(compareTerm);

  const formatted = symTerms.map((term) => formatTerm(term));

  // merge identical terms (e.g. n1 + n1 -> 2*n1)
  const termCounts: Record<string, number> = {};
  for (const term of formatted) {
    termCounts[term] = (termCounts[term] || 0) + 1;
  }

  const prelimResult = Object.entries(termCounts).map(([term, count]) =>
    count > 1 ? `${count}*${term}` : term,
  );

  // truncate backwards if needed
  const plus = compact ? '+' : ' + ';
  const gapLen = plus.length;
  let stripped = false;
  let totalLength =
    constTerm > 0
      ? constTerm.toString().length + gapLen
      : 0 +
        prelimResult.reduce((sum, term) => sum + term.length + gapLen, 0) -
        gapLen;

  prelimResult.reverse();
  while (maxLength && totalLength > maxLength - ellipsis.length - gapLen) {
    const removed = prelimResult.pop();
    if (!removed) {
      break;
    }

    stripped = true;
    totalLength -= removed.length + gapLen;
  }
  prelimResult.reverse();

  let result = prelimResult.join(plus);
  if (constTerm > 0) {
    if (result) {
      result = `${result}${plus}${constTerm}`;
    } else {
      result = `${constTerm}`;
    }
  }

  if (stripped) {
    if (!result) result = ellipsis;
    else result = `${ellipsis}${plus}${result}`;
  }

  if (cycleTime.length > 1 && parenthesize) {
    result = `(${result})`;
  }

  return result;
}

/**
 * Checks if an AnvilCycleTime represents a simple constant value of 0.
 *
 * @param cycleTime The AnvilCycleTime to check
 * @returns true if the cycle time is [{ const: 0 }] or empty, false otherwise
 */
export function isZeroCycleTime(cycleTime: AnvilCycleTime): boolean {
  if (cycleTime.length === 0) {
    return true;
  }
  if (cycleTime.length === 1) {
    const term = cycleTime[0];
    return term.const !== undefined && term.const === 0;
  }
  return false;
}

/**
 * Checks if an AnvilCycleTime contains any symbolic (non-constant) parts.
 *
 * @param cycleTime The AnvilCycleTime to check
 * @returns true if the cycle time contains any symbolic parts
 */
export function hasSymbolicParts(cycleTime: AnvilCycleTime): boolean {
  for (const term of cycleTime) {
    if (term.sym !== undefined) {
      return true;
    }
  }

  return false;
}
