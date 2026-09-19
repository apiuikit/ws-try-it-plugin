import { describe, expect, it } from 'vitest';

import {
  authorizeUrl,
  classifyScheme,
  credentialKey,
  hasSecrets,
  maskSecrets,
  planAuth,
  redactUrl,
  type AuthScheme,
  type AuthSupport,
} from './security';

describe('classifyScheme', () => {
  it.each<[string, Parameters<typeof classifyScheme>[0], AuthSupport]>([
    ['query API key', { id: 'k', type: 'httpApiKey', name: 'token', in: 'query' }, 'supported'],
    ['header API key', { id: 'k', type: 'httpApiKey', name: 'X-Api-Key', in: 'header' }, 'unsupported'],
    ['cookie API key', { id: 'k', type: 'httpApiKey', name: 'sid', in: 'cookie' }, 'browser-managed'],
    ['bearer', { id: 'b', type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'unsupported'],
    ['basic', { id: 'b', type: 'http', scheme: 'basic' }, 'unsupported'],
    ['oauth2', { id: 'o', type: 'oauth2' }, 'unsupported'],
    ['openIdConnect', { id: 'o', type: 'openIdConnect' }, 'unsupported'],
    ['client certificate', { id: 'x', type: 'X509' }, 'browser-managed'],
    ['broker user/password', { id: 'u', type: 'userPassword' }, 'not-applicable'],
    ['broker SCRAM', { id: 's', type: 'scramSha512' }, 'not-applicable'],
    ['unknown', { id: 'z', type: 'somethingNew' }, 'unsupported'],
  ])('%s → %s', (_label, input, support) => {
    expect(classifyScheme(input).support).toBe(support);
  });

  it('names the query parameter for supported keys and warns about logs', () => {
    expect(classifyScheme({ id: 'k', type: 'httpApiKey', name: 'token', in: 'query' })).toMatchObject({
      queryParam: 'token',
      summary: 'API key in query parameter "token"',
      note: expect.stringContaining('log'),
    });
  });

  it('explains header-based schemes', () => {
    expect(classifyScheme({ id: 'b', type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })).toMatchObject({
      summary: 'Bearer token (JWT) in the Authorization header',
      note: expect.stringContaining('headers'),
    });
  });
});

const scheme = (id: string, support: AuthSupport, extra: Partial<AuthScheme> = {}): AuthScheme => ({
  id,
  type: 'test',
  support,
  summary: id,
  ...extra,
});

describe('planAuth', () => {
  it('needs nothing when no security is declared', () => {
    expect(planAuth([])).toEqual({ schemes: [], optional: true, blockers: [] });
  });

  it('picks the first alternative a browser can meet', () => {
    const bearer = scheme('bearer', 'unsupported');
    const key = scheme('key', 'supported');
    expect(planAuth([[bearer], [key]])).toEqual({ schemes: [key], optional: false, blockers: [] });
  });

  it('requires every scheme in an alternative', () => {
    const key = scheme('key', 'supported');
    const header = scheme('header', 'unsupported');
    const plan = planAuth([[key, header]]);
    expect(plan.schemes).toEqual([]);
    expect(plan.blockers).toEqual([header]);
  });

  it('lists each blocker once', () => {
    const header = scheme('header', 'unsupported');
    const broker = scheme('broker', 'not-applicable');
    expect(planAuth([[header], [header, broker]]).blockers).toEqual([header, broker]);
  });

  it('treats an empty alternative as optional auth', () => {
    const key = scheme('key', 'supported');
    expect(planAuth([[], [key]])).toMatchObject({ schemes: [key], optional: true });
  });
});

describe('planAuth with a subprotocol carrier', () => {
  const bearer = classifyScheme({ id: 'b', type: 'http', scheme: 'bearer' });
  const headerKey = classifyScheme({ id: 'h', type: 'httpApiKey', name: 'X-Api-Key', in: 'header' });
  const cookie = classifyScheme({ id: 'c', type: 'httpApiKey', name: 'sid', in: 'cookie' });
  const broker = classifyScheme({ id: 'u', type: 'userPassword' });

  it('makes token schemes sendable when the site configured one', () => {
    expect(planAuth([[bearer]]).blockers).toHaveLength(1);

    const plan = planAuth([[bearer]], { subprotocol: true });
    expect(plan.schemes.map((scheme) => scheme.support)).toEqual(['via-subprotocol']);
    expect(plan.schemes[0].note).toContain('subprotocol');
    expect(plan.blockers).toEqual([]);
    expect(planAuth([[headerKey]], { subprotocol: true }).schemes[0].support).toBe('via-subprotocol');
  });

  it('leaves schemes a subprotocol cannot carry alone', () => {
    expect(planAuth([[broker]], { subprotocol: true }).blockers).toHaveLength(1);
    expect(planAuth([[cookie]], { subprotocol: true }).schemes[0].support).toBe('browser-managed');
  });
});

describe('authorizeUrl', () => {
  const key = scheme('key', 'supported', { queryParam: 'token' });

  it('adds credentials for query schemes, keeping existing parameters', () => {
    expect(authorizeUrl('ws://localhost:8787/private/echo?client=playground', [key], () => 'letmein')).toBe(
      'ws://localhost:8787/private/echo?client=playground&token=letmein',
    );
  });

  it('encodes credential values', () => {
    expect(authorizeUrl('wss://api.example.com/ws', [key], () => 'a&b=c')).toBe('wss://api.example.com/ws?token=a%26b%3Dc');
  });

  it('replaces a value already in the URL', () => {
    expect(authorizeUrl('wss://api.example.com/ws?token=old', [key], () => 'new')).toBe('wss://api.example.com/ws?token=new');
  });

  it('leaves the URL alone without credentials, supported schemes or a parsable URL', () => {
    expect(authorizeUrl('wss://api.example.com/ws', [key], () => undefined)).toBe('wss://api.example.com/ws');
    expect(authorizeUrl('wss://api.example.com/ws', [key], () => '')).toBe('wss://api.example.com/ws');
    expect(authorizeUrl('wss://api.example.com/ws', [scheme('cookie', 'browser-managed')], () => 'x')).toBe(
      'wss://api.example.com/ws',
    );
    expect(authorizeUrl('not a url', [key], () => 'x')).toBe('not a url');
  });
});

describe('redactUrl', () => {
  it('redacts credential-looking parameters and keeps the rest', () => {
    expect(redactUrl('wss://api.example.com/ws?client=docs&token=abc&api_key=def&apiKey=ghi')).toBe(
      'wss://api.example.com/ws?client=docs&token=***&api_key=***&apiKey=***',
    );
  });

  it('redacts userinfo', () => {
    expect(redactUrl('wss://user:pass@api.example.com/ws')).toBe('wss://***:***@api.example.com/ws');
  });

  it('redacts extra parameter names such as a scheme’s query parameter', () => {
    expect(redactUrl('wss://api.example.com/ws?x-tenant-secret=1', ['x-tenant-secret'])).toBe(
      'wss://api.example.com/ws?x-tenant-secret=***',
    );
  });

  it('returns URLs without secrets, and unparsable input, unchanged', () => {
    expect(redactUrl('wss://ws.kraken.com')).toBe('wss://ws.kraken.com');
    expect(redactUrl('ws://localhost:8787/echo?client=playground')).toBe('ws://localhost:8787/echo?client=playground');
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

describe('hasSecrets / maskSecrets', () => {
  it('finds and hides secret-looking fields at any depth', () => {
    const payload = { event: 'subscribe', subscription: { name: 'ownTrades', token: 'abc' } };
    expect(hasSecrets(payload)).toBe(true);
    expect(maskSecrets(payload)).toEqual({ event: 'subscribe', subscription: { name: 'ownTrades', token: '***' } });
  });

  it('handles arrays and several spellings', () => {
    const payload = { items: [{ apiKey: 'a' }, { 'api-key': 'b' }, { Password: 'c' }, { fine: 'd' }] };
    expect(hasSecrets(payload)).toBe(true);
    expect(maskSecrets(payload)).toEqual({
      items: [{ apiKey: '***' }, { 'api-key': '***' }, { Password: '***' }, { fine: 'd' }],
    });
  });

  it('leaves payloads without secrets alone', () => {
    const payload = { type: 'update', events: [{ price: '1', side: 'ask' }] };
    expect(hasSecrets(payload)).toBe(false);
    expect(maskSecrets(payload)).toEqual(payload);
  });

  it('does not mask non-scalar values or dig forever', () => {
    expect(maskSecrets({ token: { nested: 'kept' } })).toEqual({ token: { nested: 'kept' } });
    const deep: Record<string, unknown> = {};
    let node = deep;
    for (let i = 0; i < 40; i++) {
      node.next = {};
      node = node.next as Record<string, unknown>;
    }
    expect(() => maskSecrets(deep)).not.toThrow();
    expect(() => hasSecrets(deep)).not.toThrow();
  });
});

describe('credentialKey', () => {
  it('separates servers and schemes', () => {
    expect(credentialKey('a', 'b:c')).not.toBe(credentialKey('a:b', 'c'));
  });
});
