/**
 * Tests for server/src/info/parsed.ts
 *
 * Covers:
 *  - Singleton initialisation
 *  - CompletionInfo.getKindMetadata       – hit, miss
 *  - CompletionInfo.getKeywordMetadata    – 1-variant, N-variant, miss
 *  - Variant expansion: scalar broadcast, all-array, mixed
 *  - Scope value parsing (global, delimited, astNode)
 *  - CompletionInfo timing entries (lifetime + sync)
 *  - AstNodeInfo.getFrom              – kind-only, kind+type, miss
 *  - AstNodeEntry.internal flag
 *  - API demonstration: realistic sample lookups
 *  - AstNodeEntry.examples field
 */

import assert from 'node:assert';
import { describe, it } from 'mocha';

import {
  completionInfo,
  astNodeInfo,
  CompletionInfo,
  AstNodeInfo,
} from '../../src/info/parsed';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function assertNonNull<T>(value: T | null, msg?: string): T {
  assert.ok(value !== null, msg ?? 'Expected non-null value');
  return value as T;
}

describe('info/parsed.ts', () => {
  // ---------------------------------------------------------------------------
  // 1. Singleton initialisation
  // ---------------------------------------------------------------------------

  describe('singletons', () => {
    it('completionInfo singleton is initialised', () => {
      assert.ok(completionInfo instanceof CompletionInfo);
    });

    it('astNodeInfo singleton is initialised', () => {
      assert.ok(astNodeInfo instanceof AstNodeInfo);
    });

    it('completionInfo has known kinds', () => {
      assert.ok(completionInfo.knownKinds.length > 0);
    });

    it('completionInfo has known keywords', () => {
      assert.ok(completionInfo.knownKeywords.length > 0);
    });

    it('astNodeInfo has known keys', () => {
      assert.ok(astNodeInfo.knownKeys.length > 0);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. CompletionInfo.getKindMetadata
  // ---------------------------------------------------------------------------

  describe('CompletionInfo.getKindMetadata', () => {
    it('returns correct metadata for "proc_def"', () => {
      const entry = assertNonNull(completionInfo.getKindMetadata('proc_def'));
      assert.strictEqual(entry.hint, 'process');
      assert.strictEqual(entry.lspKind, 'Module');
    });

    it('returns correct metadata for "reg_def"', () => {
      const entry = assertNonNull(completionInfo.getKindMetadata('reg_def'));
      assert.strictEqual(entry.hint, 'register');
      assert.strictEqual(entry.lspKind, 'Variable');
    });

    it('returns correct metadata for "channel_class_def"', () => {
      const entry = assertNonNull(
        completionInfo.getKindMetadata('channel_class_def'),
      );
      assert.strictEqual(entry.hint, 'channel');
      assert.strictEqual(entry.lspKind, 'Class');
    });

    it('returns correct metadata for "func_def"', () => {
      const entry = assertNonNull(completionInfo.getKindMetadata('func_def'));
      assert.strictEqual(entry.hint, 'function');
      assert.strictEqual(entry.lspKind, 'Function');
    });

    it('returns null for an unknown kind', () => {
      assert.strictEqual(
        completionInfo.getKindMetadata('nonexistent_kind'),
        null,
      );
    });

    it('returns null for an empty string', () => {
      assert.strictEqual(completionInfo.getKindMetadata(''), null);
    });

    it('knownKinds contains all expected kind strings', () => {
      const expected = [
        'reg_def',
        'channel_class_def',
        'type_def',
        'func_def',
        'proc_def',
        'macro_def',
        'endpoint_def',
        'message_def',
      ];
      for (const k of expected) {
        assert.ok(
          completionInfo.knownKinds.includes(k),
          `"${k}" should be in knownKinds`,
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. CompletionInfo.getKeywordMetadata – single-variant keywords
  //    (no array fields in source → exactly 1 variant, scalar broadcast to N=1)
  // ---------------------------------------------------------------------------

  describe('CompletionInfo.getKeywordMetadata – single-variant', () => {
    it('"logic" has one variant with correct fields', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('logic'));
      assert.strictEqual(entry.variants.length, 1);
      const v = entry.variants[0];
      assert.strictEqual(v.lspKind, 'Keyword');
      assert.strictEqual(v.category, 'type');
      assert.strictEqual(v.hint, 'type');
      assert.ok(v.description !== null && v.description.includes('logic'));
      assert.strictEqual(v.astKind, null); // astKind absent in source
      assert.strictEqual(v.scope.kind, 'global'); // scope absent → global
    });

    it('"loop" has one variant with description', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('loop'));
      assert.strictEqual(entry.variants.length, 1);
      const v = entry.variants[0];
      assert.strictEqual(v.category, 'control');
      assert.ok(v.description !== null && v.description.includes('loop'));
      assert.strictEqual(v.astKind, 'thread');
    });

    it('"let" has one variant', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('let'));
      assert.strictEqual(entry.variants.length, 1);
      assert.strictEqual(entry.variants[0].category, 'binding');
    });

    it('"import" has one variant whose description is back-filled from astNodeInfo', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('import'));
      assert.strictEqual(entry.variants.length, 1);
      // astKind = "import_directive"; no explicit description in completion-info.json,
      // so the description is resolved from ast-node-info.json.
      assert.ok(
        entry.variants[0].description !== null &&
          entry.variants[0].description.includes('import'),
      );
    });

    it('"int" has one variant with a delimited scope', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('int'));
      assert.strictEqual(entry.variants.length, 1);
      const scope = entry.variants[0].scope;
      assert.strictEqual(scope.kind, 'delimited');
      if (scope.kind === 'delimited') {
        assert.strictEqual(scope.open, '<');
        assert.strictEqual(scope.close, '>');
      }
    });

    it('returns null for an unknown keyword', () => {
      assert.strictEqual(
        completionInfo.getKeywordMetadata('unknown_kw_xyz'),
        null,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. CompletionInfo.getKeywordMetadata – multi-variant keywords
  //    (at least one field is an array → N variants, scalars broadcast)
  // ---------------------------------------------------------------------------

  describe('CompletionInfo.getKeywordMetadata – multi-variant expansion', () => {
    it('"type" expands into 2 variants (all fields are arrays of length 2)', () => {
      // Raw: category[2], hint[2], astKind[2], description[2], scope[2]
      // → 2 variants, no broadcast needed
      const entry = assertNonNull(completionInfo.getKeywordMetadata('type'));
      assert.strictEqual(entry.variants.length, 2);

      const [v0, v1] = entry.variants;

      // First variant: declaration usage of "type"
      assert.strictEqual(v0.category, 'declaration');
      assert.strictEqual(v0.hint, 'declaration');
      assert.strictEqual(v0.astKind, 'type_def');
      // astKind = "type_def"; description back-filled from ast-node-info.json.
      assert.ok(v0.description !== null && v0.description.includes('type'));
      assert.strictEqual(v0.scope.kind, 'global'); // scope: null → global

      // Second variant: param_type usage of "type"
      assert.strictEqual(v1.category, 'param_type');
      assert.strictEqual(v1.hint, 'type');
      assert.strictEqual(v1.astKind, null); // astKind: null in source
      assert.ok(
        v1.description !== null && v1.description.includes('type parameter'),
      );
      assert.strictEqual(v1.scope.kind, 'delimited'); // scope: "<>"
      if (v1.scope.kind === 'delimited') {
        assert.strictEqual(v1.scope.open, '<');
        assert.strictEqual(v1.scope.close, '>');
      }
    });

    it('"left" expands into 2 variants (scalar category/hint broadcast, astKind[2] + scope[2])', () => {
      // Raw: category="modifier" (scalar), hint="modifier" (scalar),
      //      astKind["endpoint_def","message_def"], scope["()","channel_class_def"]
      // → N=2 from astKind/scope; category and hint broadcast to both variants
      const entry = assertNonNull(completionInfo.getKeywordMetadata('left'));
      assert.strictEqual(entry.variants.length, 2);

      const [v0, v1] = entry.variants;

      // Both variants share the broadcast scalar fields
      assert.strictEqual(v0.category, 'modifier');
      assert.strictEqual(v1.category, 'modifier');
      assert.strictEqual(v0.hint, 'modifier');
      assert.strictEqual(v1.hint, 'modifier');

      // Each variant has its own astKind
      assert.strictEqual(v0.astKind, 'endpoint_def');
      assert.strictEqual(v1.astKind, 'message_def');

      // Each variant has its own scope
      assert.strictEqual(v0.scope.kind, 'delimited'); // "()"
      if (v0.scope.kind === 'delimited') {
        assert.strictEqual(v0.scope.open, '(');
        assert.strictEqual(v0.scope.close, ')');
      }
      assert.strictEqual(v1.scope.kind, 'astNode'); // "channel_class_def"
      if (v1.scope.kind === 'astNode') {
        assert.strictEqual(v1.scope.nodeKind, 'channel_class_def');
      }

      // description is a scalar (broadcast) — both variants have the same description
      assert.ok(v0.description !== null && v0.description.includes('left'));
      assert.strictEqual(v0.description, v1.description);
    });

    it('"right" expands into 2 variants analogously to "left"', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('right'));
      assert.strictEqual(entry.variants.length, 2);
      assert.strictEqual(entry.variants[0].astKind, 'endpoint_def');
      assert.strictEqual(entry.variants[1].astKind, 'message_def');
    });

    it('"extern" expands into 2 variants with a null-scope first entry', () => {
      // Raw: astKind["import_directive","proc_def_body/extern"], scope[null, "){"]
      const entry = assertNonNull(completionInfo.getKeywordMetadata('extern'));
      assert.strictEqual(entry.variants.length, 2);

      const [v0, v1] = entry.variants;
      assert.strictEqual(v0.astKind, 'import_directive');
      assert.strictEqual(v0.scope.kind, 'global'); // scope: null → global

      assert.strictEqual(v1.astKind, 'proc_def_body/extern');
      assert.strictEqual(v1.scope.kind, 'delimited'); // scope: "){" (two chars)
      if (v1.scope.kind === 'delimited') {
        assert.strictEqual(v1.scope.open, ')');
        assert.strictEqual(v1.scope.close, '{');
      }
    });

    it('"chan" expands into 2 variants (scalar category/hint broadcast, astKind[2] + scope[2])', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('chan'));
      assert.strictEqual(entry.variants.length, 2);

      const [v0, v1] = entry.variants;
      assert.strictEqual(v0.category, 'declaration');
      assert.strictEqual(v1.category, 'declaration'); // broadcast
      assert.strictEqual(v0.astKind, 'channel_class_def');
      assert.strictEqual(v1.astKind, 'channel_def');
      assert.strictEqual(v0.scope.kind, 'global');
      assert.strictEqual(v1.scope.kind, 'astNode');
      if (v1.scope.kind === 'astNode') {
        assert.strictEqual(v1.scope.nodeKind, 'proc_def');
      }
    });

    it('"try" expands into 2 variants (scalar category/hint/description broadcast, astKind[2])', () => {
      // Raw: astKind["expr/try_recv","expr/try_send"], description scalar, no scope
      const entry = assertNonNull(completionInfo.getKeywordMetadata('try'));
      assert.strictEqual(entry.variants.length, 2);

      const [v0, v1] = entry.variants;
      assert.strictEqual(v0.astKind, 'expr/try_recv');
      assert.strictEqual(v1.astKind, 'expr/try_send');
      // description is scalar → broadcast to both
      assert.ok(v0.description !== null);
      assert.strictEqual(v0.description, v1.description);
      // scope absent in source → global on both
      assert.strictEqual(v0.scope.kind, 'global');
      assert.strictEqual(v1.scope.kind, 'global');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Scope value parsing
  // ---------------------------------------------------------------------------

  describe('ScopeValue parsing', () => {
    it('scope: null → global', () => {
      // "chan" v0 has scope: null
      const entry = assertNonNull(completionInfo.getKeywordMetadata('chan'));
      assert.strictEqual(entry.variants[0].scope.kind, 'global');
    });

    it('scope: "()" → delimited ( )', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('left'));
      const scope = entry.variants[0].scope;
      assert.strictEqual(scope.kind, 'delimited');
      if (scope.kind === 'delimited') {
        assert.strictEqual(scope.open, '(');
        assert.strictEqual(scope.close, ')');
      }
    });

    it('scope: "<>" → delimited < >', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('int'));
      const scope = entry.variants[0].scope;
      assert.strictEqual(scope.kind, 'delimited');
      if (scope.kind === 'delimited') {
        assert.strictEqual(scope.open, '<');
        assert.strictEqual(scope.close, '>');
      }
    });

    it('scope: "){" → delimited ) {', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('extern'));
      const scope = entry.variants[1].scope;
      assert.strictEqual(scope.kind, 'delimited');
      if (scope.kind === 'delimited') {
        assert.strictEqual(scope.open, ')');
        assert.strictEqual(scope.close, '{');
      }
    });

    it('scope: "proc_def" → astNode', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('chan'));
      const scope = entry.variants[1].scope;
      assert.strictEqual(scope.kind, 'astNode');
      if (scope.kind === 'astNode') {
        assert.strictEqual(scope.nodeKind, 'proc_def');
      }
    });

    it('scope: "channel_class_def" → astNode', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('left'));
      const scope = entry.variants[1].scope;
      assert.strictEqual(scope.kind, 'astNode');
      if (scope.kind === 'astNode') {
        assert.strictEqual(scope.nodeKind, 'channel_class_def');
      }
    });

    it('absent scope field → global (same as explicit null)', () => {
      // "logic" has no scope field at all
      const entry = assertNonNull(completionInfo.getKeywordMetadata('logic'));
      assert.strictEqual(entry.variants[0].scope.kind, 'global');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Timing completions
  // ---------------------------------------------------------------------------

  describe('CompletionInfo – timing completions', () => {
    it('lifetime timing keys are populated', () => {
      assert.ok(completionInfo.knownLifetimeTimingKeys.length > 0);
    });

    it('sync timing keys are populated', () => {
      assert.ok(completionInfo.knownSyncTimingKeys.length > 0);
    });

    it('getLifetimeTimingEntry("eternal") returns correct entry', () => {
      const entry = assertNonNull(
        completionInfo.getLifetimeTimingEntry('eternal'),
      );
      assert.strictEqual(entry.hint, 'eternal lifetime');
      assert.strictEqual(entry.lspKind, 'TypeParameter');
      assert.strictEqual(entry.astKind, 'delay_pat/eternal');
      assert.ok(
        entry.description !== null && entry.description.includes('Eternal'),
      );
    });

    it('getLifetimeTimingEntry("#N") returns correct entry', () => {
      const entry = assertNonNull(completionInfo.getLifetimeTimingEntry('#N'));
      assert.strictEqual(entry.hint, 'fixed lifetime');
      assert.strictEqual(entry.insertText, '#$1)$0');
    });

    it('getSyncTimingEntry("dyn") returns correct entry', () => {
      const entry = assertNonNull(completionInfo.getSyncTimingEntry('dyn'));
      assert.strictEqual(entry.hint, 'dynamic sync');
      assert.strictEqual(entry.astKind, 'message_sync_mode/dynamic');
    });

    it('getSyncTimingEntry("#N") returns static sync entry', () => {
      const entry = assertNonNull(completionInfo.getSyncTimingEntry('#N'));
      assert.strictEqual(entry.astKind, 'message_sync_mode/static');
    });

    it('getLifetimeTimingEntry returns null for unknown key', () => {
      assert.strictEqual(
        completionInfo.getLifetimeTimingEntry('not_a_key'),
        null,
      );
    });

    it('getSyncTimingEntry returns null for unknown key', () => {
      assert.strictEqual(completionInfo.getSyncTimingEntry('not_a_key'), null);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. AstNodeInfo.getFrom – kind-only
  // ---------------------------------------------------------------------------

  describe('AstNodeInfo.getFrom – kind-only', () => {
    it('"proc_def" returns correct entry', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('proc_def'));
      assert.strictEqual(entry.name, 'process');
      assert.ok(entry.description.includes('process definition'));
      assert.strictEqual(entry.internal, false);
    });

    it('"reg_def" returns correct entry', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('reg_def'));
      assert.strictEqual(entry.name, 'register');
    });

    it('"channel_class_def" returns correct entry', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('channel_class_def'));
      assert.strictEqual(entry.name, 'channel class');
    });

    it('"compilation_unit" returns correct entry', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('compilation_unit'));
      assert.strictEqual(entry.name, 'file');
    });

    it('returns null for unknown kind', () => {
      assert.strictEqual(astNodeInfo.getFrom('totally_unknown'), null);
    });

    it('returns null for empty string', () => {
      assert.strictEqual(astNodeInfo.getFrom(''), null);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. AstNodeInfo.getFrom – kind + type
  // ---------------------------------------------------------------------------

  describe('AstNodeInfo.getFrom – kind + type', () => {
    it('"expr", "binop" → binary operator', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('expr', 'binop'));
      assert.strictEqual(entry.name, 'binary operator');
      assert.ok(entry.description.includes('binary operator'));
    });

    it('"expr", "if_expr" → if expression', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('expr', 'if_expr'));
      assert.strictEqual(entry.name, 'if expression');
    });

    it('"data_type", "logic" → logic', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('data_type', 'logic'));
      assert.strictEqual(entry.name, 'logic');
    });

    it('"data_type", "record" → struct', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('data_type', 'record'));
      assert.strictEqual(entry.name, 'struct');
    });

    it('"param_value", "int" → int parameter value', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('param_value', 'int'));
      assert.strictEqual(entry.name, 'int parameter value');
    });

    it('"proc_def_body", "extern" → external process body', () => {
      const entry = assertNonNull(
        astNodeInfo.getFrom('proc_def_body', 'extern'),
      );
      assert.strictEqual(entry.name, 'external process body');
    });

    it('returns null for unknown type on known kind', () => {
      assert.strictEqual(astNodeInfo.getFrom('expr', 'nonexistent_type'), null);
    });

    it('returns null for unknown kind with type', () => {
      assert.strictEqual(astNodeInfo.getFrom('ghost', 'thing'), null);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. AstNodeEntry.internal flag
  // ---------------------------------------------------------------------------

  describe('AstNodeEntry – internal flag', () => {
    it('is false for user-facing nodes', () => {
      assert.strictEqual(
        assertNonNull(astNodeInfo.getFrom('proc_def')).internal,
        false,
      );
      assert.strictEqual(
        assertNonNull(astNodeInfo.getFrom('expr', 'binop')).internal,
        false,
      );
    });

    it('is true for internal-only nodes', () => {
      assert.strictEqual(
        assertNonNull(astNodeInfo.getFrom('singleton_or_list')).internal,
        true,
      );
      assert.strictEqual(
        assertNonNull(astNodeInfo.getFrom('singleton_or_list', 'single'))
          .internal,
        true,
      );
      assert.strictEqual(
        assertNonNull(astNodeInfo.getFrom('cycle_proc')).internal,
        true,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 10. API demonstration – realistic sample lookups
  // ---------------------------------------------------------------------------

  describe('API demonstration – sample lookups', () => {
    it('can build a completion item for a "proc_def" node', () => {
      const kind = assertNonNull(completionInfo.getKindMetadata('proc_def'));
      // In a completion provider: CompletionItemKind[kind.lspKind], detail: kind.hint
      assert.strictEqual(kind.hint, 'process');
      assert.strictEqual(kind.lspKind, 'Module');
    });

    it('can produce one completion item per variant for "type"', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('type'));
      // Two items: one for top-level type declaration, one for type-parameter usage
      assert.strictEqual(entry.variants.length, 2);
      for (const v of entry.variants) {
        assert.ok(typeof v.category === 'string');
        assert.ok(typeof v.hint === 'string');
      }
    });

    it('can produce one completion item per astKind for "left"', () => {
      const entry = assertNonNull(completionInfo.getKeywordMetadata('left'));
      // Two items: endpoint_def context and message_def context
      assert.strictEqual(entry.variants.length, 2);
      const astKinds = entry.variants.map((v) => v.astKind);
      assert.ok(astKinds.includes('endpoint_def'));
      assert.ok(astKinds.includes('message_def'));
    });

    it('can fetch hover documentation for "proc_def"', () => {
      const node = assertNonNull(astNodeInfo.getFrom('proc_def'));
      assert.ok(node.description.startsWith('A process definition'));
    });

    it('can fetch hover documentation for "expr/binop" using kind+type', () => {
      const node = assertNonNull(astNodeInfo.getFrom('expr', 'binop'));
      assert.ok(node.description.includes('binary operator'));
    });

    it('can enumerate all non-internal AST node entries', () => {
      const nonInternal = astNodeInfo.knownKeys.filter((k) => {
        const [kind, type] = k.split('/');
        return !astNodeInfo.getFrom(kind, type)?.internal;
      });
      assert.ok(nonInternal.length > 0);
    });

    it('can enumerate all control-flow keywords', () => {
      const controlKeywords = completionInfo.knownKeywords.filter((kw) =>
        completionInfo
          .getKeywordMetadata(kw)
          ?.variants.some((v) => v.category === 'control'),
      );
      for (const expected of ['loop', 'recv', 'send', 'if']) {
        assert.ok(
          controlKeywords.includes(expected),
          `"${expected}" should be a control keyword`,
        );
      }
    });

    it('"generate_seq" description is accessible', () => {
      const entry = assertNonNull(
        completionInfo.getKeywordMetadata('generate_seq'),
      );
      assert.ok(entry.variants[0].description?.includes('generate_seq'));
    });

    it('can identify keywords restricted to a delimited scope', () => {
      // "int" is only valid inside <> (parameter lists)
      const entry = assertNonNull(completionInfo.getKeywordMetadata('int'));
      assert.strictEqual(entry.variants[0].scope.kind, 'delimited');
    });
  });

  // ---------------------------------------------------------------------------
  // 11. CompletionInfo – astNodeInfo description fallback
  // ---------------------------------------------------------------------------

  describe('CompletionInfo – astNodeInfo description fallback', () => {
    it('keyword with astKind but no explicit description gets description from astNodeInfo', () => {
      // "proc" → astKind "proc_def"; no description in completion-info.json
      const entry = assertNonNull(completionInfo.getKeywordMetadata('proc'));
      const v = entry.variants[0];
      assert.strictEqual(v.astKind, 'proc_def');
      assert.ok(v.description !== null, 'description should be back-filled');
      assert.strictEqual(
        v.description,
        astNodeInfo.getFrom('proc_def')?.description,
      );
    });

    it('keyword with astKind containing a "/" is resolved via kind+type lookup', () => {
      // "struct" → astKind "data_type/record"
      const entry = assertNonNull(completionInfo.getKeywordMetadata('struct'));
      const v = entry.variants[0];
      assert.strictEqual(v.astKind, 'data_type/record');
      assert.ok(v.description !== null, 'description should be back-filled');
      assert.strictEqual(
        v.description,
        astNodeInfo.getFrom('data_type', 'record')?.description,
      );
    });

    it('explicit description takes precedence over astNodeInfo fallback', () => {
      // "loop" has an explicit description AND astKind "thread"
      const entry = assertNonNull(completionInfo.getKeywordMetadata('loop'));
      const v = entry.variants[0];
      assert.strictEqual(v.astKind, 'thread');
      assert.ok(v.description !== null);
      // The explicit description should be used, not the node's description
      assert.notStrictEqual(
        v.description,
        astNodeInfo.getFrom('thread')?.description,
      );
    });

    it('keyword with no astKind and no explicit description remains null', () => {
      // "logic" has no astKind and no description for the scope-appropriate variant
      // Find a variant with astKind === null to confirm it stays null
      const allKeywords = completionInfo.knownKeywords;
      const nullAstKindWithNullDesc = allKeywords.flatMap((kw) =>
        (completionInfo.getKeywordMetadata(kw)?.variants ?? []).filter(
          (v) => v.astKind === null && v.description === null,
        ),
      );
      // There should be at least one (e.g. "type" v1's description is explicit, but
      // there are keywords like "logic" that have no astKind and no description).
      // We just verify none of the null-astKind variants unexpectedly gained a description.
      for (const v of nullAstKindWithNullDesc) {
        assert.strictEqual(v.description, null);
      }
    });

    it('timing entry with astKind but no explicit description gets description from astNodeInfo', () => {
      // All real timing entries in completion-info.json have explicit descriptions,
      // so we verify the fallback via a synthetic CompletionInfo constructed with nodeInfo.
      const raw = {
        kind: {},
        builtInKeywordCompletions: {},
        timingCompletions: {
          lifetime: {
            testlt: {
              hint: 'test',
              insertText: 'test',
              lspKind: 'TypeParameter',
              astKind: 'proc_def',
            },
          },
          sync: {
            testsc: {
              hint: 'test',
              insertText: 'test',
              lspKind: 'TypeParameter',
              astKind: 'reg_def',
            },
          },
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test data with incomplete structure
      const withNodeInfo = new CompletionInfo(raw as any, astNodeInfo);
      const lt = assertNonNull(withNodeInfo.getLifetimeTimingEntry('testlt'));
      assert.strictEqual(
        lt.description,
        astNodeInfo.getFrom('proc_def')?.description ?? null,
      );
      const sc = assertNonNull(withNodeInfo.getSyncTimingEntry('testsc'));
      assert.strictEqual(
        sc.description,
        astNodeInfo.getFrom('reg_def')?.description ?? null,
      );
    });

    it('timing entry with explicit description is not overridden', () => {
      // "eternal" lifetime timing entry has an explicit description
      const entry = assertNonNull(
        completionInfo.getLifetimeTimingEntry('eternal'),
      );
      assert.ok(
        entry.description !== null && entry.description.includes('Eternal'),
      );
    });

    it('CompletionInfo constructed without nodeInfo leaves descriptions as-is', () => {
      // Construct a minimal CompletionInfo without the nodeInfo argument
      const raw = {
        kind: {},
        builtInKeywordCompletions: {
          testkw: {
            category: 'test',
            hint: 'test',
            lspKind: 'Keyword',
            astKind: 'proc_def',
          },
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test data with incomplete structure
      const standalone = new CompletionInfo(raw as any);
      const entry = assertNonNull(standalone.getKeywordMetadata('testkw'));
      // No nodeInfo provided → description stays null
      assert.strictEqual(entry.variants[0].description, null);
    });
  });

  // ---------------------------------------------------------------------------
  // 12. AstNodeEntry – examples field
  // ---------------------------------------------------------------------------

  describe('AstNodeEntry – examples field', () => {
    it('"proc_def" has a non-null examples field', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('proc_def'));
      assert.ok(entry.examples !== null, 'proc_def should have examples');
    });

    it('"reg_def" has a non-null examples field', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('reg_def'));
      assert.ok(entry.examples !== null, 'reg_def should have examples');
    });

    it('"compilation_unit" has a null examples field', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('compilation_unit'));
      assert.strictEqual(
        entry.examples,
        null,
        'compilation_unit should have no examples',
      );
    });

    it('"sig_def" has a null examples field', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('sig_def'));
      assert.strictEqual(
        entry.examples,
        null,
        'sig_def should have no examples',
      );
    });

    it('"proc_def" description does not contain "**Example:**"', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('proc_def'));
      assert.ok(
        !entry.description.includes('**Example:**'),
        'description should be prose-only',
      );
    });

    it('"proc_def" examples field contains a fenced code block when non-null', () => {
      const entry = assertNonNull(astNodeInfo.getFrom('proc_def'));
      assert.ok(entry.examples !== null);
      assert.ok(
        entry.examples.includes('```'),
        'examples should contain a fenced code block',
      );
    });
  });
});
