import { describe, expect, it } from 'vitest';

import { toClientDirection } from './direction';

describe('toClientDirection', () => {
  it.each([
    ['receive', 'clientSends'],
    ['send', 'clientReceives'],
    ['publish', 'clientSends'],
    ['subscribe', 'clientReceives'],
  ] as const)('maps spec action "%s" to %s', (action, expected) => {
    expect(toClientDirection(action)).toBe(expected);
  });

  it('rejects unknown actions', () => {
    expect(() => toClientDirection('reply')).toThrow('Unknown operation action');
  });
});
