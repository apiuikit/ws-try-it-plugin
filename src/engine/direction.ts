/**
 * Spec actions describe what the *application* does; a test client does the opposite.
 * Normalize once at the parser boundary and never read the raw action again (PROJECT.MD §5).
 */
export type SpecAction = 'send' | 'receive' | 'publish' | 'subscribe';

export type ClientDirection = 'clientSends' | 'clientReceives';

const DIRECTIONS: Record<SpecAction, ClientDirection> = {
  // AsyncAPI 3.x
  receive: 'clientSends',
  send: 'clientReceives',
  // AsyncAPI 2.x
  publish: 'clientSends',
  subscribe: 'clientReceives',
};

export function toClientDirection(action: string): ClientDirection {
  const direction = DIRECTIONS[action as SpecAction];
  if (!direction) {
    throw new Error(`Unknown operation action: "${action}"`);
  }
  return direction;
}
