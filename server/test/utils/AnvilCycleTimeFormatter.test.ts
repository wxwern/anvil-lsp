import assert from 'node:assert';
import { describe, it } from 'mocha';

import {
  formatCycleTime,
  formatCycleTimeDefinitions,
} from '../../src/utils/AnvilCycleTimeFormatter';
import type { AnvilCycleTime, AnvilEventExpr } from '../../src/core/ast/schema';

describe('AnvilCycleTimeFormatter', () => {
  it('formats top-level symbolic sums without inlining lookup expressions', () => {
    const cycleTime: AnvilCycleTime = [{ sym: 'or1' }, { sym: 'or2' }];

    assert.strictEqual(formatCycleTime(cycleTime), 'or1 + or2');
  });

  it('formats lookup-table timing variable definitions as separate lines', () => {
    const cycleTime: AnvilCycleTime = [{ sym: 'or1' }, { sym: 'or2' }];
    const lookup: Record<string, AnvilEventExpr> = {
      or1: {
        type: 'or',
        value: [[{ sym: 'n2' }], [{ sym: 'n3' }]],
      },
      or2: {
        type: 'or',
        value: [[{ sym: 'n4' }], [{ sym: 'max0' }]],
      },
      max0: {
        type: 'max',
        value: [[{ sym: 'n5' }], [{ const: 2 }, { sym: 'n6' }]],
      },
    };

    assert.deepStrictEqual(formatCycleTimeDefinitions(cycleTime, lookup), [
      'max0 = max(n5, (n6 + 2))',
      'or1 = n2 / n3',
      'or2 = n4 / max0',
      'n2, n3, n4, n5, n6 = ?',
    ]);
  });

  it('can suppress unknown symbolic remainder definitions', () => {
    const cycleTime: AnvilCycleTime = [{ sym: 'or1' }];
    const lookup: Record<string, AnvilEventExpr> = {
      or1: {
        type: 'or',
        value: [[{ sym: 'n2' }], [{ sym: 'n3' }]],
      },
    };

    assert.deepStrictEqual(
      formatCycleTimeDefinitions(cycleTime, lookup, { includeUnknowns: false }),
      ['or1 = n2 / n3'],
    );
  });
});
