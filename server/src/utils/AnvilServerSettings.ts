
export interface AnvilServerSettings {
    maxNumberOfProblems: number;
    projectRoot?: string;
    executablePath?: string;
    snippets?: { fancy?: boolean; };
    inlayHints?: { timingInfo?: boolean };
    debug?: boolean;
}

export const DEFAULT_ANVIL_SERVER_SETTINGS: AnvilServerSettings = {
    maxNumberOfProblems: 1000,
    inlayHints: { timingInfo: true }
};

