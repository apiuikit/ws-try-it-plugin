import { describe, expect, it } from 'vitest';

import { dedupeMessages, inferDiscriminator, matchFrame, type MessageShape } from './routing';

const message = (id: string, properties: Record<string, unknown>): MessageShape => ({
  id,
  name: id,
  payloadSchema: { type: 'object', properties },
});

describe('inferDiscriminator', () => {
  it('finds a property with a distinct const per message', () => {
    const discriminator = inferDiscriminator([
      message('ping', { requestId: { type: 'string' }, type: { const: 'ping' } }),
      message('pong', { type: { const: 'pong' }, requestId: { type: 'string' } }),
      message('tick', { type: { enum: ['tick'] } }),
    ]);
    expect(discriminator?.property).toBe('type');
    expect(matchFrame({ type: 'pong', requestId: 'r1' }, discriminator)).toBe('pong');
    expect(matchFrame({ type: 'tick' }, discriminator)).toBe('tick');
  });

  it('gives up when values collide or a message lacks the property', () => {
    expect(
      inferDiscriminator([message('a', { type: { const: 'x' } }), message('b', { type: { const: 'x' } })]),
    ).toBeUndefined();
    expect(
      inferDiscriminator([message('a', { type: { const: 'x' } }), message('b', { kind: { const: 'y' } })]),
    ).toBeUndefined();
  });

  it('reads consts through allOf and agreeing oneOf branches', () => {
    // Shape of Kraken's subscriptionStatus: oneOf error/success, each allOf a shared schema.
    const common = { type: 'object', properties: { event: { const: 'subscriptionStatus' } } };
    const status: MessageShape = {
      id: 'subscriptionStatus',
      name: 'subscriptionStatus',
      payloadSchema: {
        type: 'object',
        oneOf: [
          { allOf: [{ properties: { errorMessage: { type: 'string' } } }, common] },
          { allOf: [{ properties: { channelID: { type: 'integer' } } }, common] },
        ],
      },
    };

    const discriminator = inferDiscriminator([status, message('ping', { event: { const: 'ping' } })]);
    expect(discriminator?.property).toBe('event');
    expect(matchFrame({ event: 'subscriptionStatus', status: 'error' }, discriminator)).toBe(
      'subscriptionStatus',
    );
  });

  it('rejects oneOf branches that disagree', () => {
    expect(
      inferDiscriminator([
        message('a', { type: { const: 'a' } }),
        {
          id: 'b',
          name: 'b',
          payloadSchema: {
            oneOf: [{ properties: { type: { const: 'b1' } } }, { properties: { type: { const: 'b2' } } }],
          },
        },
      ]),
    ).toBeUndefined();
  });

  it('ignores messages without a payload schema', () => {
    expect(inferDiscriminator([{ id: 'raw', name: 'raw' }])).toBeUndefined();
  });
});

describe('matchFrame', () => {
  const discriminator = inferDiscriminator([message('ping', { type: { const: 'ping' } })]);

  it('returns undefined for unmatched or non-object frames', () => {
    expect(matchFrame({ type: 'error' }, discriminator)).toBeUndefined();
    expect(matchFrame({ other: 1 }, discriminator)).toBeUndefined();
    expect(matchFrame('ping', discriminator)).toBeUndefined();
    expect(matchFrame({ type: 'ping' }, undefined)).toBeUndefined();
  });
});

describe('dedupeMessages', () => {
  it('keeps the first message per id', () => {
    expect(dedupeMessages([message('a', {}), message('b', {}), message('a', {})]).map((m) => m.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
