const AST_SCHEMA_VERSION_REGEX = /^v(\d+)\.(\d+)\.(\d+)(-wip\.(\d+))?$/;

export function parseAstSchemaVersion(versionStr: string) {
  const matches = versionStr.match(AST_SCHEMA_VERSION_REGEX);
  if (!matches)
    throw new Error(`Invalid AST schema version string: ${versionStr}.`);

  const [_, majorStr, minorStr, patchStr, _wipLabel, wipPart] = matches;
  return {
    major: parseInt(majorStr, 10),
    minor: parseInt(minorStr, 10),
    patch: parseInt(patchStr, 10),
    wip_build: wipPart ? parseInt(wipPart, 10) : undefined,
  };
}

/**
 * Compares two AST schema versions.
 *
 * This excludes WIP build numbers from the comparison.
 */
export function compareAstSchemaVersions(
  a: ReturnType<typeof parseAstSchemaVersion> | string,
  b: ReturnType<typeof parseAstSchemaVersion> | string,
) {
  if (typeof a === 'string') a = parseAstSchemaVersion(a);
  if (typeof b === 'string') b = parseAstSchemaVersion(b);

  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  return 0; // versions are equal
}

/**
 * Checks if the input AST schema version is compatible with the required version.
 */
export function isAstSchemaVersionCompatible(
  inputVersion: string,
  requiredVersion: string,
) {
  const i = parseAstSchemaVersion(inputVersion);
  const r = parseAstSchemaVersion(requiredVersion);
  const cmp = compareAstSchemaVersions(i, r);

  if (cmp === 0 && i.wip_build !== r.wip_build) {
    return false; // versions are incompatible due to WIP status
  }

  // compatible if i >= r and major versions match
  return cmp >= 0 && i.major === r.major;
}
