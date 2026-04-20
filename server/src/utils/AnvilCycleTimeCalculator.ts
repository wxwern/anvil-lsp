import { AnvilCycleTime } from '../core/ast/schema';

function cloneCycleTime(cycleTime: AnvilCycleTime): AnvilCycleTime {
  return cycleTime.map((term) => {
    if ('const' in term) {
      return { const: term.const };
    }
    if ('sym' in term && !('or' in term) && !('max' in term)) {
      return { sym: term.sym };
    }
    if ('or' in term) {
      return {
        ...(term.sym ? { sym: term.sym } : {}),
        or: term.or.map(cloneCycleTime),
      };
    }
    return {
      ...(term.sym ? { sym: term.sym } : {}),
      max: term.max.map(cloneCycleTime),
    };
  });
}

/**
 * Computes sustain-end cycle timestamp expression:
 * execute-cycle + blocking/consumption-cycle + sustain-cycle
 *
 * If execute-cycle is unavailable, it is treated as symbolic unknown `?`.
 */
export function computeSustainEndCycle(
  executeCycle: AnvilCycleTime | undefined,
  blockingCycle: AnvilCycleTime | undefined,
  sustainCycle: AnvilCycleTime,
): AnvilCycleTime {
  const execute = executeCycle ? cloneCycleTime(executeCycle) : [{ sym: '?' }];
  const blocking = blockingCycle ? cloneCycleTime(blockingCycle) : [];
  const sustain = cloneCycleTime(sustainCycle);

  return [...execute, ...blocking, ...sustain];
}
