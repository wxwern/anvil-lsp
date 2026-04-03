import { AnvilCycleTime, AnvilCycleTimeTerm } from '../core/ast/schema';

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

function compareTerm(a: AnvilCycleTimeTerm, b: AnvilCycleTimeTerm): number {
  const aIsConst = 'const' in a;
  const bIsConst = 'const' in b;
  const aIsSym = 'sym' in a && !('max' in a) && !('or' in a);
  const bIsSym = 'sym' in b && !('max' in b) && !('or' in b);
  const aIsMaxOrOr = ('max' in a) || ('or' in a);
  const bIsMaxOrOr = ('max' in b) || ('or' in b);

  if (aIsSym && !bIsSym) return -1; // Symbolic variables first
  if (!aIsSym && bIsSym) return 1;
  if (aIsMaxOrOr && !bIsMaxOrOr) return -1; // Max/or terms next
  if (!aIsMaxOrOr && bIsMaxOrOr) return 1;
  if (aIsConst && !bIsConst) return 1; // Constants last
  if (!aIsConst && bIsConst) return -1;

  const symSorter = (a: string, b: string) => {
    const pattern = /^(.*?)(\d+)?$/; // Matches base name and optional numeric suffix
    const aMatch = a.match(pattern);
    const bMatch = b.match(pattern);

    if (!aMatch || !bMatch) {
      return a.localeCompare(b); // Fallback to lexicographical order
    }

    const aBase = aMatch[1];
    const aNum = aMatch[2] ? parseInt(aMatch[2], 10) : 0;
    const bBase = bMatch[1];
    const bNum = bMatch[2] ? parseInt(bMatch[2], 10) : 0;

    if (aBase === bBase) {
      return aNum - bNum; // Sort by numeric suffix if base names are the same
    }

    return aBase.localeCompare(bBase); // Otherwise sort by base name
  };

  if ((aIsSym || aIsMaxOrOr) && (bIsSym || bIsMaxOrOr)) {
    const aName = a.sym;
    const bName = b.sym;
    return symSorter(aName || '', bName || '');
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

  if (aFirstSym && 'sym' in aFirstSym && bFirstSym && 'sym' in bFirstSym) {
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
function formatTerm(term: AnvilCycleTimeTerm, ascii: boolean, compact: boolean, parenthesize: boolean): string {
  const ellipsis = ascii ? '...' : '…';

  // Constant value
  if ('const' in term) {
    return term.const.toString();
  }

  // Symbolic variable (not part of max or or)
  if ('sym' in term && !('max' in term) && !('or' in term)) {
    return term.sym;
  }

  // Max operation
  if ('max' in term) {
    const formatted = term.max
      .map(s => s.sort(compareTerm))
      .sort(compareCycleTimes)
      .map(sum => formatCycleTime(sum, { ascii, compact, parenthesize: true /*forced for inner terms*/ }));

    const prefix = 'sym' in term ? term.sym : 'max';
    const separator = compact ? '/' : ', ';
    const result =
      compact && formatted.length > 3
      ? `${ellipsis}${separator}${formatted.slice(- 2).join(separator)}`
      : formatted.join(separator);

    if (formatted.length > 1 || parenthesize) {
      return `${prefix}{${result}}`;
    } else {
      return result;
    }
  }

  // Or operation
  if ('or' in term && Array.isArray(term.or)) {
    const formatted = term.or
      .map(s => s.sort(compareTerm))
      .sort(compareCycleTimes)
      .map(sum => formatCycleTime(sum, { ascii, compact, parenthesize: true /*forced for inner terms*/ }));

    const prefix = 'sym' in term ? term.sym : '';
    const separator = compact ? '/' : ' / ';
    const result =
      compact && formatted.length > 3
      ? `${ellipsis}${separator}${formatted.slice(- 2).join(separator)}`
      : formatted.join(separator);

    if (formatted.length > 1 || parenthesize) {
      if (prefix) {
        return `${prefix}{${result}}`;
      } else {
        return `(${result})`;
      }
    } else {
      return result;
    }
  }

  // Fallback for unknown structure
  return '?';
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
  const { maxLength, ascii = false, compact = false, parenthesize = false } = options;

  if (cycleTime.length === 0) {
    return '0';
  }

  const ellipsis = ascii ? '......' : '……';

  let constTerm = 0;
  const symTerms: AnvilCycleTimeTerm[] = [];

  for (const term of cycleTime) {
    if ('const' in term) {
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

  const formatted = symTerms.map((term) => formatTerm(term, ascii, compact, parenthesize));

  // merge identical terms (e.g. n1 + n1 -> 2*n1)
  const termCounts: Record<string, number> = {};
  for (const term of formatted) {
    termCounts[term] = (termCounts[term] || 0) + 1;
  }

  const prelimResult = Object.entries(termCounts)
    .map(([term, count]) => (count > 1 ? `${count}*${term}` : term))

  // truncate backwards if needed
  const plus = compact ? '+' : ' + ';
  const gapLen = plus.length;
  let stripped = false;
  let totalLength =
    constTerm > 0 ? constTerm.toString().length + gapLen : 0 +
    prelimResult.reduce((sum, term) => sum + term.length + gapLen, 0) - gapLen;

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
    return 'const' in term && term.const === 0;
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
    if ('sym' in term && !('max' in term)) {
      // Direct symbolic variable
      return true;
    }

    if ('max' in term) {
      // Check if any of the max terms have symbolic parts
      if (term.max.some(hasSymbolicParts)) {
        return true;
      }
    }

    if ('or' in term) {
      // Check if any of the or terms have symbolic parts
      if (term.or.some(hasSymbolicParts)) {
        return true;
      }
    }
  }

  return false;
}
