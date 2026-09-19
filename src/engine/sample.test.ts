import { describe, expect, it } from 'vitest';

import { exampleText, sampleFromSchema } from './sample';

describe('sampleFromSchema', () => {
  it('prefers const, default, examples and enum', () => {
    expect(sampleFromSchema({ type: 'string', const: 'ping' })).toBe('ping');
    expect(sampleFromSchema({ type: 'number', default: 5 })).toBe(5);
    expect(sampleFromSchema({ type: 'string', examples: ['abc'] })).toBe('abc');
    expect(sampleFromSchema({ enum: ['a', 'b'] })).toBe('a');
  });

  it('builds objects, arrays and primitives', () => {
    expect(
      sampleFromSchema({
        type: 'object',
        properties: {
          type: { const: 'ping' },
          requestId: { type: 'string' },
          count: { type: 'integer' },
          tags: { type: 'array', items: { type: 'boolean' } },
          data: {},
        },
      }),
    ).toEqual({ type: 'ping', requestId: '', count: 0, tags: [false], data: null });
  });

  it('includes only required properties when the schema lists them', () => {
    expect(
      sampleFromSchema({
        type: 'object',
        required: ['event', 'subscription'],
        properties: {
          event: { const: 'subscribe' },
          reqid: { type: 'integer' },
          subscription: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { enum: ['book', 'ticker'] },
              depth: { default: 10 },
              snapshot: { default: true },
            },
          },
        },
      }),
    ).toEqual({ event: 'subscribe', subscription: { name: 'book' } });
  });

  it('follows the first oneOf branch and merges allOf', () => {
    expect(sampleFromSchema({ oneOf: [{ type: 'integer' }, { type: 'string' }] })).toBe(0);
    expect(
      sampleFromSchema({
        allOf: [{ properties: { a: { const: 1 } } }, { properties: { b: { const: 2 } } }],
      }),
    ).toEqual({ a: 1, b: 2 });
  });

  it('stops on deeply nested schemas', () => {
    const schema: Record<string, unknown> = { type: 'object', properties: {} };
    (schema.properties as Record<string, unknown>).self = schema;
    expect(() => sampleFromSchema(schema)).not.toThrow();
  });
});

describe('exampleText', () => {
  it('uses the first example when present', () => {
    expect(exampleText({ id: 'm', name: 'm', example: { type: 'ping' } })).toBe('{\n  "type": "ping"\n}');
  });

  it('falls back to a schema sample and keeps strings raw', () => {
    expect(exampleText({ id: 'm', name: 'm', payloadSchema: { type: 'boolean' } })).toBe('false');
    expect(exampleText({ id: 'm', name: 'm', example: 'hello' })).toBe('hello');
  });
});
