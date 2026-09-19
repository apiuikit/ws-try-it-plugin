import { describe, expect, it } from 'vitest';

import type { Frame } from './connection';
import type { MessageShape } from './routing';
import {
  FULL_VALIDATION_MAX_LENGTH,
  identifyBySchema,
  isSupportedSchemaFormat,
  MAX_REPORTED_ISSUES,
  schemaDraftFor,
  validateFrame,
  validatePayload,
} from './validation';

// Kraken's subscribe payload, as the parser resolves it.
const subscribeSchema = {
  type: 'object',
  required: ['event'],
  properties: {
    event: { type: 'string', const: 'subscribe' },
    reqid: { type: 'integer' },
    pair: { type: 'array', items: { type: 'string', pattern: '[A-Z\\s]+\\/[A-Z\\s]+' } },
    subscription: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', enum: ['book', 'ticker'] } },
    },
  },
};

// Gemini's market data payload: oneOf heartbeat/update, each an allOf with a shared part.
const shared = { type: 'object', required: ['type', 'socket_sequence'], properties: { socket_sequence: { type: 'integer' } } };
const marketSchema = {
  type: 'object',
  oneOf: [
    { allOf: [{ properties: { type: { type: 'string', const: 'heartbeat' } }, required: ['type'] }, shared] },
    {
      allOf: [
        {
          required: ['type', 'events'],
          properties: {
            type: { type: 'string', const: 'update' },
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: { price: { type: 'number' }, side: { type: 'string', enum: ['bid', 'side'] } },
              },
            },
          },
        },
        shared,
      ],
    },
  ],
};

const frameOf = (json: unknown, extra: Partial<Frame> = {}): Frame => {
  const text = JSON.stringify(json);
  return { id: 1, direction: 'in', at: 0, text, size: text.length, binary: false, isJson: true, json, ...extra };
};

describe('validatePayload', () => {
  it('accepts valid payloads', () => {
    expect(
      validatePayload(subscribeSchema, { event: 'subscribe', reqid: 1, pair: ['XBT/USD'], subscription: { name: 'ticker' } }),
    ).toEqual({ status: 'valid' });
  });

  it('reports each leaf problem at its payload path', () => {
    const result = validatePayload(subscribeSchema, {
      event: 'subscribe',
      reqid: '22',
      pair: ['XBTUSD'],
      subscription: { name: 'tickers' },
    });
    expect(result.status).toBe('invalid');
    const issues = result.status === 'invalid' ? result.issues : [];
    expect(issues.map((issue) => issue.path).sort()).toEqual(['/pair/0', '/reqid', '/subscription/name']);
    expect(issues.find((issue) => issue.path === '/reqid')?.message).toContain('integer');
  });

  it('reports only the closest oneOf branch', () => {
    const result = validatePayload(marketSchema, {
      type: 'update',
      socket_sequence: 1,
      events: [{ price: '76290.58', side: 'ask' }],
    });
    expect(result.status === 'invalid' && result.issues.map((issue) => issue.path).sort()).toEqual([
      '/events/0/price',
      '/events/0/side',
    ]);
    expect(validatePayload(marketSchema, { type: 'heartbeat', socket_sequence: 5 })).toEqual({ status: 'valid' });
  });

  it('reports a failing declared property once under additionalProperties: false', () => {
    // Gemini's events items. cfworker also flags failing declared properties as "additional".
    const schema = {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { price: { type: 'number' }, side: { type: 'string', enum: ['bid', 'side'] } },
          },
        },
      },
    };
    const result = validatePayload(schema, { events: [{ price: '1.5', side: 'ask', extra: true }] });
    const issues = result.status === 'invalid' ? result.issues : [];

    expect(issues.map((issue) => issue.path).sort()).toEqual(['/events/0', '/events/0/price', '/events/0/side']);
    // The undeclared property is reported once, at its parent.
    expect(issues.find((issue) => issue.path === '/events/0')?.message).toContain('"extra"');
    expect(issues.some((issue) => issue.message.includes('False boolean schema'))).toBe(false);
  });

  it('keeps errors from an explicit false schema', () => {
    const result = validatePayload({ type: 'object', properties: { legacy: false } }, { legacy: 1 });
    expect(result).toMatchObject({ status: 'invalid', issues: [{ path: '/legacy' }] });
  });

  it('caps reported issues but counts them all', () => {
    const result = validatePayload({ type: 'array', items: { type: 'number' } }, Array(120).fill('x'));
    expect(result).toMatchObject({ status: 'invalid', issueCount: 120 });
    expect(result.status === 'invalid' && result.issues).toHaveLength(MAX_REPORTED_ISSUES);
    expect(result.status === 'invalid' && result.partial).toBeUndefined();
  });

  it('can stop at the first issue', () => {
    const result = validatePayload({ type: 'array', items: { type: 'number' } }, Array(120).fill('x'), undefined, {
      stopAtFirstIssue: true,
    });
    expect(result).toMatchObject({ status: 'invalid', partial: true });
    expect(result.status === 'invalid' && result.issueCount).toBeLessThan(120);
  });

  it('handles thousands of issues inside a oneOf branch quickly', () => {
    // Shape of Gemini's order book snapshot: one update carrying thousands of off-spec events.
    const value = {
      type: 'update',
      socket_sequence: 0,
      events: Array.from({ length: 5000 }, () => ({ price: '76290.58', side: 'ask' })),
    };
    const started = performance.now();
    const result = validatePayload(marketSchema, value);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result).toMatchObject({ status: 'invalid', issueCount: 10_000 });
  });

  it('explains a payload matching several oneOf branches', () => {
    const result = validatePayload({ oneOf: [{ type: 'object' }, { type: 'object' }] }, {});
    expect(result).toMatchObject({ status: 'invalid', issues: [{ path: '/' }] });
  });

  it('handles boolean and missing schemas', () => {
    expect(validatePayload(true, 1)).toEqual({ status: 'valid' });
    expect(validatePayload(false, 1)).toMatchObject({ status: 'invalid' });
    expect(validatePayload(undefined, 1)).toMatchObject({ status: 'unsupported' });
  });

  it('declines schema formats that are not JSON Schema', () => {
    expect(validatePayload({ type: 'record' }, {}, 'application/vnd.apache.avro;version=1.9.0')).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('avro'),
    });
  });
});

describe('isSupportedSchemaFormat', () => {
  it.each([
    [undefined, true],
    ['application/vnd.aai.asyncapi;version=3.1.0', true],
    ['application/vnd.aai.asyncapi+json;version=3.0.0', true],
    ['application/vnd.aai.asyncapi+yaml;version=2.6.0', true],
    ['application/schema+json;version=draft-07', true],
    ['application/vnd.apache.avro;version=1.9.0', false],
    ['application/vnd.oai.openapi;version=3.0.0', false],
    ['application/vnd.google.protobuf;version=3', false],
  ])('%s → %s', (format, expected) => {
    expect(isSupportedSchemaFormat(format)).toBe(expected);
  });
});

describe('schemaDraftFor', () => {
  it.each([
    [undefined, '7'],
    ['application/vnd.aai.asyncapi;version=3.1.0', '7'],
    ['application/schema+json;version=draft-04', '4'],
    ['application/schema+json;version=draft-07', '7'],
    ['application/schema+yaml;version=draft-2019-09', '2019-09'],
    ['application/schema+json; version=draft-2020-12', '2020-12'],
    ['application/schema+json', '7'],
  ])('%s → draft %s', (format, expected) => {
    expect(schemaDraftFor(format)).toBe(expected);
  });
});

describe('validateFrame', () => {
  const market: MessageShape = { id: 'marketData', name: 'marketData', payloadSchema: marketSchema };

  it('validates each frame once', () => {
    const frame = frameOf({ type: 'heartbeat', socket_sequence: 1 });
    const first = validateFrame(frame, market);
    expect(first).toEqual({ status: 'valid' });
    expect(validateFrame(frame, market)).toBe(first);
  });

  it('checks large frames only up to their first problem', () => {
    const frame = frameOf(
      { type: 'update', socket_sequence: 0, events: [{ price: '1', side: 'ask' }] },
      { size: FULL_VALIDATION_MAX_LENGTH + 1 },
    );
    expect(validateFrame(frame, market)).toMatchObject({ status: 'invalid', partial: true });
  });

  it('skips binary, truncated and schemaless frames', () => {
    expect(validateFrame(frameOf(null, { binary: true, isJson: false }), market)).toBeUndefined();
    expect(validateFrame(frameOf(null, { truncated: true, isJson: false }), market)).toBeUndefined();
    expect(validateFrame(frameOf({}), { id: 'raw', name: 'raw' })).toBeUndefined();
  });

  it('validates non-JSON text as a string', () => {
    const text: MessageShape = { id: 'text', name: 'text', payloadSchema: { type: 'string' } };
    expect(validateFrame(frameOf(null, { text: 'hello', isJson: false, json: undefined }), text)).toEqual({ status: 'valid' });
  });
});

describe('identifyBySchema', () => {
  const a: MessageShape = { id: 'a', name: 'a', payloadSchema: { type: 'object', required: ['x'] } };
  const b: MessageShape = { id: 'b', name: 'b', payloadSchema: { type: 'object', required: ['y'] } };
  const any: MessageShape = { id: 'any', name: 'any', payloadSchema: { type: 'object' } };

  it('returns the only message whose schema accepts the frame', () => {
    expect(identifyBySchema(frameOf({ y: 1 }), [a, b])).toBe('b');
  });

  it('returns nothing when no schema or several accept it', () => {
    expect(identifyBySchema(frameOf({ z: 1 }), [a, b])).toBeUndefined();
    expect(identifyBySchema(frameOf({ x: 1 }), [a, any])).toBeUndefined();
  });
});
