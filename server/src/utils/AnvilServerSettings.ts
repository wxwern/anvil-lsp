
/**
 * Controls when Anvil syntax concept explanations (drawn from
 * ast-node-info.json) are shown to the user.  Source code, go-to-definition
 * links, and other documentation are always shown regardless of this setting.
 *
 * Accepted forms:
 *   - `true`              -> onHover: true,  onAutocomplete: "anvilKeywords"
 *   - `false`             -> onHover: false, onAutocomplete: "none"
 *   - An object with individual overrides for each surface.
 *
 * `onAutocomplete` values:
 *   - `"none"`           - Never show syntax explanations in autocomplete
 *                          popups.
 *   - `"anvilKeywords"`  - Show syntax explanations only for built-in Anvil
 *                          keywords and operators (default).
 *   - `"all"`            - Show syntax explanations for all completions,
 *                          including user-defined identifiers.
 *   - `true`             - Alias for "all".
 *   - `false`            - Alias for "none".
 */
export type ShowSyntaxHelp =
    | boolean
    | {
        onHover?: boolean;
        onAutocomplete?: 'none' | 'anvilKeywords' | 'all' | boolean;
        includeExamples?: boolean;
    };

/** Fully-resolved, normalised form of ShowSyntaxHelp. */
export interface ResolvedShowSyntaxHelp {
    onHover: boolean;
    onAutocomplete: 'none' | 'anvilKeywords' | 'all';
    includeExamples: boolean;
}

/**
 * Normalise any accepted ShowSyntaxHelp value into the canonical resolved form.
 * Missing fields fall back to the defaults: onHover=true, onAutocomplete="anvilKeywords", includeExamples=false.
 */
export function resolveShowSyntaxHelp(raw: ShowSyntaxHelp | undefined): ResolvedShowSyntaxHelp {
    if (raw === undefined || raw === null) {
        return { onHover: true, onAutocomplete: 'anvilKeywords', includeExamples: false };
    }
    if (typeof raw === 'boolean') {
        return {
            onHover: raw,
            onAutocomplete: raw ? 'anvilKeywords' : 'none',
            includeExamples: false,
        };
    }
    const onAutocomplete = (() => {
        const v = raw.onAutocomplete;
        if (v === true)  return 'all'  as const;
        if (v === false) return 'none' as const;
        if (v === 'anvilKeywords' || v === 'all' || v === 'none') return v;
        return 'anvilKeywords' as const;
    })();
    return {
        onHover: raw.onHover ?? true,
        onAutocomplete,
        includeExamples: raw.includeExamples ?? false,
    };
}

export interface AnvilServerSettings {
    maxNumberOfProblems?: number;
    projectRoot?: string;
    executablePath?: string;
    snippets?: { fancy?: boolean; };
    inlayHints?: { timingInfo?: boolean };
    showSyntaxHelp?: ShowSyntaxHelp;
    debug?: boolean;
}

export const DEFAULT_ANVIL_SERVER_SETTINGS: AnvilServerSettings = {
    maxNumberOfProblems: 1000,
    inlayHints: { timingInfo: true },
    showSyntaxHelp: { onHover: true, onAutocomplete: 'anvilKeywords' },
};
