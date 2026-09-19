import { describe, expect, it } from 'vitest';

import { buildTargetUrl, isHostAllowed, precheck, queryDefaults, substituteVariables } from './url';

describe('isHostAllowed', () => {
  it.each([
    ['wss://api.example.com/x', 'api.example.com', true],
    ['wss://api.example.com:8443/x', 'api.example.com', true],
    ['ws://localhost:8787/echo', 'localhost:8787', true],
    ['ws://localhost:9999/echo', 'localhost:8787', false],
    ['wss://eu.api.example.com', '*.example.com', true],
    ['wss://example.com', '*.example.com', false],
    ['wss://evil-example.com', '*.example.com', false],
    ['wss://API.Example.com', ' api.example.COM ', true],
    ['wss://api.example.com.evil.io', 'api.example.com', false],
  ])('%s against "%s" → %s', (target, pattern, expected) => {
    expect(isHostAllowed(new URL(target), [pattern])).toBe(expected);
  });

  it('tests RegExps against host, even global ones called repeatedly', () => {
    const pattern = /^ws\.kraken\.com$/g;
    expect(isHostAllowed(new URL('wss://ws.kraken.com'), [pattern])).toBe(true);
    expect(isHostAllowed(new URL('wss://ws.kraken.com'), [pattern])).toBe(true);
    expect(isHostAllowed(new URL('wss://ws.kraken.com:444'), [pattern])).toBe(false);
  });

  it('allows nothing with an empty list', () => {
    expect(isHostAllowed(new URL('wss://ws.kraken.com'), [])).toBe(false);
  });
});

describe('substituteVariables', () => {
  it('replaces known placeholders and reports unknown ones', () => {
    expect(substituteVariables('wss://{env}.example.com:{port}', { env: 'staging' })).toEqual({
      url: 'wss://staging.example.com:{port}',
      unresolved: ['port'],
    });
  });

  it('encodes values when asked', () => {
    expect(substituteVariables('/rooms/{room}', { room: 'a b' }, { encode: true }).url).toBe(
      '/rooms/a%20b',
    );
  });
});

describe('buildTargetUrl', () => {
  it('joins server url and channel address without doubling slashes', () => {
    expect(buildTargetUrl({ serverUrl: 'ws://localhost:8787/', address: '/echo' }).url).toBe(
      'ws://localhost:8787/echo',
    );
    expect(buildTargetUrl({ serverUrl: 'ws://localhost:8787/api', address: 'echo' }).url).toBe(
      'ws://localhost:8787/api/echo',
    );
  });

  it('keeps the server url when the channel has no address', () => {
    expect(buildTargetUrl({ serverUrl: 'wss://example.com/socket', address: null }).url).toBe(
      'wss://example.com/socket',
    );
  });

  it('substitutes variables and parameters and appends the query', () => {
    expect(
      buildTargetUrl({
        serverUrl: 'wss://{host}/',
        serverVariables: { host: 'example.com' },
        address: '/rooms/{roomId}',
        channelParameters: {},
        query: { client: 'playground', skip: undefined },
      }),
    ).toEqual({ url: 'wss://example.com/rooms/{roomId}?client=playground', unresolved: ['roomId'] });
  });
});

describe('queryDefaults', () => {
  it('reads defaults from the ws binding query schema', () => {
    expect(
      queryDefaults({
        query: {
          type: 'object',
          properties: { client: { type: 'string', default: 'playground' }, token: { type: 'string' } },
        },
      }),
    ).toEqual({ client: 'playground' });
  });

  it('tolerates a missing binding', () => {
    expect(queryDefaults(undefined)).toEqual({});
  });
});

describe('precheck', () => {
  it('accepts ws and wss urls', () => {
    expect(precheck('ws://localhost:8787/echo')).toEqual({ ok: true });
    expect(precheck('wss://example.com', { pageProtocol: 'https:' })).toEqual({ ok: true });
  });

  it.each([
    ['ws://example.com/{id}', 'unresolved-variables'],
    ['not a url', 'invalid-url'],
    ['http://example.com', 'unsupported-scheme'],
  ])('rejects %s as %s', (target, reason) => {
    expect(precheck(target)).toMatchObject({ ok: false, reason });
  });

  it('blocks hosts outside the allowlist', () => {
    const allowedHosts = ['ws.kraken.com'];
    expect(precheck('wss://ws.kraken.com', { allowedHosts })).toEqual({ ok: true });
    expect(precheck('wss://evil.example/ws', { allowedHosts })).toMatchObject({
      ok: false,
      reason: 'host-not-allowed',
      message: expect.stringContaining('evil.example'),
    });
  });

  it('blocks ws:// to remote hosts from https pages only', () => {
    expect(precheck('ws://example.com', { pageProtocol: 'https:' })).toMatchObject({
      ok: false,
      reason: 'mixed-content',
    });
    expect(precheck('ws://example.com', { pageProtocol: 'http:' })).toEqual({ ok: true });
    expect(precheck('ws://127.0.0.1:8787', { pageProtocol: 'https:' })).toEqual({ ok: true });
  });
});
