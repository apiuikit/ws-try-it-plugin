import { describe, expect, it } from 'vitest';

import type { Frame } from './connection';
import {
  correlate,
  correlationKey,
  correlationValue,
  parseLocation,
  readPointer,
  schemaAt,
  withCorrelationValue,
  writePointer,
} from './correlation';
import type { MessageShape } from './routing';

describe('parseLocation', () => {
  it('parses payload and header expressions', () => {
    expect(parseLocation('$message.payload#/reqid')).toMatchObject({ source: 'payload', tokens: ['reqid'] });
    expect(parseLocation('$message.header#/meta/correlationId')).toMatchObject({
      source: 'header',
      tokens: ['meta', 'correlationId'],
    });
  });

  it('decodes pointer escapes and percent-encoding', () => {
    expect(parseLocation('$message.payload#/a~1b/c~0d/e%20f')?.tokens).toEqual(['a/b', 'c~d', 'e f']);
  });

  it('treats a missing fragment as the whole payload', () => {
    expect(parseLocation('$message.payload')?.tokens).toEqual([]);
  });

  it.each([undefined, '', '$message.body#/id', '$message.payload#id', 'reqid'])('rejects %s', (expression) => {
    expect(parseLocation(expression)).toBeUndefined();
  });
});

describe('pointers', () => {
  const value = { a: { list: [{ id: 7 }] } };

  it('reads nested objects and arrays', () => {
    expect(readPointer(value, ['a', 'list', '0', 'id'])).toBe(7);
    expect(readPointer(value, ['a', 'missing'])).toBeUndefined();
    expect(readPointer(value, ['a', 'list', 'x'])).toBeUndefined();
    expect(readPointer({ toString: 1 }, ['constructor'])).toBeUndefined();
  });

  it('writes without mutating and creates missing objects', () => {
    const next = writePointer(value, ['a', 'list', '0', 'id'], 8);
    expect(readPointer(next, ['a', 'list', '0', 'id'])).toBe(8);
    expect(value.a.list[0].id).toBe(7);
    expect(writePointer({}, ['x', 'y'], 1)).toEqual({ x: { y: 1 } });
  });

  it('finds the schema at a pointer through compositions', () => {
    const schema = {
      allOf: [{ properties: { reqid: { type: 'integer' } } }, { properties: { other: { type: 'string' } } }],
    };
    expect(schemaAt(schema, ['reqid'])).toEqual({ type: 'integer' });
    expect(schemaAt({ properties: { list: { items: { properties: { id: { type: 'string' } } } } } }, ['list', '0', 'id'])).toEqual({
      type: 'string',
    });
    expect(schemaAt(schema, ['nope'])).toBeUndefined();
  });
});

describe('correlation values', () => {
  it('generates ids of the schema type', () => {
    expect(correlationValue({ type: 'integer' }, 3)).toBe(3);
    expect(correlationValue({ type: 'string' }, 3)).toBe('req-3');
    expect(correlationValue(undefined, 3)).toBe('req-3');
  });

  it('keys scalars only and keeps types distinct', () => {
    expect(correlationKey(42)).not.toBe(correlationKey('42'));
    expect(correlationKey('')).toBeUndefined();
    expect(correlationKey(null)).toBeUndefined();
    expect(correlationKey({ id: 1 })).toBeUndefined();
  });

  it('sets the id in JSON text', () => {
    const location = parseLocation('$message.payload#/reqid')!;
    expect(withCorrelationValue('{"event":"ping"}', location, 5)).toBe('{\n  "event": "ping",\n  "reqid": 5\n}');
    expect(withCorrelationValue('not json', location, 5)).toBeUndefined();
    expect(withCorrelationValue('{}', parseLocation('$message.header#/id')!, 5)).toBeUndefined();
  });
});

describe('correlate', () => {
  const ping: MessageShape = { id: 'ping', name: 'ping', correlationId: '$message.payload#/reqid' };
  const pong: MessageShape = { id: 'pong', name: 'pong', correlationId: '$message.payload#/reqid' };

  let nextId = 1;
  const frame = (direction: Frame['direction'], json: unknown, at: number): Frame => {
    const text = JSON.stringify(json);
    return { id: nextId++, direction, at, text, size: text.length, binary: false, isJson: true, json };
  };
  const out = (json: unknown, at: number, source = 'receivePing'): Frame => ({
    ...frame('out', json, at),
    source,
  });
  const inbound = (json: unknown, at: number): Frame => frame('in', json, at);
  const messageIdOf = (frame: Frame) => (frame.json as { event?: string }).event;
  const options = { operationId: 'receivePing', requestMessages: [ping], replyMessages: [pong], messageIdOf };

  it('links replies to requests and measures latency', () => {
    const request = out({ event: 'ping', reqid: 1 }, 1000);
    const heartbeat = inbound({ event: 'heartbeat', reqid: 1 }, 1010);
    const reply = inbound({ event: 'pong', reqid: 1 }, 1083);
    const result = correlate([request, heartbeat, reply], options);

    expect(result.requests.get(request.id)).toMatchObject({
      field: 'reqid',
      value: 1,
      replyFrameIds: [reply.id],
      latencyMs: 83,
    });
    expect(result.replies.get(reply.id)).toEqual({ requestFrameId: request.id, field: 'reqid', value: 1, latencyMs: 83 });
    expect(result.replies.has(heartbeat.id)).toBe(false);
  });

  it('records requests without an id and replies it cannot place', () => {
    const request = out({ event: 'ping' }, 0);
    const stray = inbound({ event: 'pong', reqid: 99 }, 5);
    const result = correlate([request, stray], options);

    expect(result.requests.get(request.id)).toMatchObject({ field: 'reqid', key: undefined, replyFrameIds: [] });
    expect(result.replies.size).toBe(0);
    expect(result.keyedInbound.has(stray.id)).toBe(true);
  });

  it('ignores requests sent by other operations', () => {
    const other = out({ event: 'ping', reqid: 1 }, 0, 'somethingElse');
    const reply = inbound({ event: 'pong', reqid: 1 }, 5);
    const result = correlate([other, reply], options);
    expect(result.requests.size).toBe(0);
    expect(result.replies.size).toBe(0);
  });

  it('attributes a reused id to the latest request and collects multiple replies', () => {
    const first = out({ event: 'ping', reqid: 1 }, 0);
    const second = out({ event: 'ping', reqid: 1 }, 10);
    const a = inbound({ event: 'pong', reqid: 1 }, 20);
    const b = inbound({ event: 'pong', reqid: 1 }, 30);
    const result = correlate([first, second, a, b], options);

    expect(result.requests.get(first.id)?.replyFrameIds).toEqual([]);
    expect(result.requests.get(second.id)).toMatchObject({ replyFrameIds: [a.id, b.id], latencyMs: 10 });
  });

  it('does not match ids of different types', () => {
    const request = out({ event: 'ping', reqid: 1 }, 0);
    const reply = inbound({ event: 'pong', reqid: '1' }, 5);
    expect(correlate([request, reply], options).replies.size).toBe(0);
  });

  it('falls back to the request location when replies declare none', () => {
    const request = out({ event: 'ping', reqid: 3 }, 0);
    const reply = inbound({ event: 'pong', reqid: 3 }, 5);
    const result = correlate([request, reply], {
      ...options,
      replyMessages: [{ id: 'pong', name: 'pong' }],
    });
    expect(result.replies.get(reply.id)?.requestFrameId).toBe(request.id);
  });

  it('is disabled when requests declare no payload correlation id', () => {
    const result = correlate([out({ event: 'ping', reqid: 1 }, 0)], {
      ...options,
      requestMessages: [{ id: 'ping', name: 'ping', correlationId: '$message.header#/id' }],
    });
    expect(result.enabled).toBe(false);
    expect(result.requests.size).toBe(0);
  });
});
