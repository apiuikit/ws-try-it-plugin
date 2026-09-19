export interface UrlResolution {
  url: string;
  /** Placeholder names that had no value and were left in the URL. */
  unresolved: string[];
}

const PLACEHOLDERS = /\{([^{}]+)\}/g;
const HAS_PLACEHOLDER = /\{[^{}]+\}/;

export function substituteVariables(
  template: string,
  values: Record<string, string | undefined>,
  { encode = false }: { encode?: boolean } = {},
): UrlResolution {
  const unresolved: string[] = [];
  const url = template.replace(PLACEHOLDERS, (match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      unresolved.push(name);
      return match;
    }
    return encode ? encodeURIComponent(value) : value;
  });
  return { url, unresolved };
}

export interface TargetInput {
  /** `server.url()`: protocol, host and pathname, possibly with `{variables}`. */
  serverUrl: string;
  serverVariables?: Record<string, string | undefined>;
  /** Channel address, possibly with `{parameters}`. */
  address?: string | null;
  channelParameters?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
}

export function buildTargetUrl(input: TargetInput): UrlResolution {
  const server = substituteVariables(input.serverUrl, input.serverVariables ?? {});
  const address = substituteVariables(input.address ?? '', input.channelParameters ?? {}, {
    encode: true,
  });

  let url = server.url.replace(/\/+$/, '');
  if (address.url) {
    url += address.url.startsWith('/') ? address.url : `/${address.url}`;
  }

  const params = Object.entries(input.query ?? {}).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  if (params.length > 0) {
    const search = new URLSearchParams(params.map(([key, value]) => [key, String(value)]));
    url += `${url.includes('?') ? '&' : '?'}${search.toString()}`;
  }

  return { url, unresolved: [...server.unresolved, ...address.unresolved] };
}

/** Default values of the ws channel binding's `query` schema. */
export function queryDefaults(binding: unknown): Record<string, unknown> {
  const properties = (binding as { query?: { properties?: unknown } } | undefined)?.query
    ?.properties;
  if (!properties || typeof properties !== 'object') {
    return {};
  }
  const defaults: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(properties)) {
    if (schema && typeof schema === 'object' && 'default' in schema) {
      defaults[name] = (schema as { default: unknown }).default;
    }
  }
  return defaults;
}

/**
 * An allowed host: `api.example.com` (any port), `localhost:8787` (that port only),
 * `*.example.com` (subdomains, not the apex), or a RegExp tested against `host` (with port).
 */
export type HostPattern = string | RegExp;

export function isHostAllowed(url: URL, patterns: readonly HostPattern[]): boolean {
  const hostname = url.hostname.toLowerCase();
  const host = url.host.toLowerCase();
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) {
      // A global RegExp keeps state between calls.
      pattern.lastIndex = 0;
      return pattern.test(host);
    }
    const normalized = pattern.trim().toLowerCase();
    if (normalized.startsWith('*.')) {
      return hostname.endsWith(normalized.slice(1));
    }
    return hostname === normalized || host === normalized;
  });
}

export type PrecheckResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'unresolved-variables'
        | 'invalid-url'
        | 'unsupported-scheme'
        | 'host-not-allowed'
        | 'mixed-content';
      message: string;
    };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface PrecheckEnv {
  /** Protocol of the hosting page. */
  pageProtocol?: string;
  /** Hosts connections may target. Any host when omitted. */
  allowedHosts?: readonly HostPattern[];
}

/**
 * Catches the failures the browser would otherwise report as an opaque close code 1006
 * (PROJECT.MD §8.4), plus the embedding site's host allowlist. Anything not detectable here
 * is left to the connection attempt.
 */
export function precheck(target: string, env: PrecheckEnv = {}): PrecheckResult {
  if (HAS_PLACEHOLDER.test(target)) {
    return {
      ok: false,
      reason: 'unresolved-variables',
      message: 'The URL still contains {placeholders}.',
    };
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { ok: false, reason: 'invalid-url', message: `"${target}" is not a valid URL.` };
  }

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return {
      ok: false,
      reason: 'unsupported-scheme',
      message: `Only ws:// and wss:// URLs are supported, got ${url.protocol}//.`,
    };
  }

  if (env.allowedHosts && !isHostAllowed(url, env.allowedHosts)) {
    return {
      ok: false,
      reason: 'host-not-allowed',
      message: `This site doesn’t allow connections to ${url.host}.`,
    };
  }

  const loopback = LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost');
  if (env.pageProtocol === 'https:' && url.protocol === 'ws:' && !loopback) {
    return {
      ok: false,
      reason: 'mixed-content',
      message:
        'This page is served over HTTPS, so the browser blocks unencrypted ws:// connections to remote hosts. Use wss://.',
    };
  }

  return { ok: true };
}
