import { useMemo } from 'react';

import { analyzeFrames, type FrameAnalysis } from '../engine/analysis';
import type { Frame } from '../engine/connection';
import type { OperationIntent } from '../engine/intent';

export type { FrameAnalysis };

/** Recomputed when the log changes; validation results are cached per frame, so this stays cheap. */
export function useFrameAnalysis(intent: OperationIntent, frames: readonly Frame[]): FrameAnalysis {
  return useMemo(() => analyzeFrames(intent, frames), [intent, frames]);
}
