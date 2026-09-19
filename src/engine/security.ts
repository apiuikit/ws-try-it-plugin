/**
 * Security schemes, from a browser's point of view (PROJECT.MD §8.1, §8.2). `new WebSocket(url,
 * protocols)` can't set headers or read the handshake response, so most HTTP-style schemes can't
 * be sent from a docs page. Classify each scheme once, and explain what can't work instead of
 * failing with an opaque close code 1006.
 */

/** The fields of an AsyncAPI security scheme this module needs. */
export interface SecuritySchemeInput {
  id: string;
  type: string;
  /** httpApiKey: the query parameter, header or cookie name. */
  name?: string;
  /** httpApiKey: `query`, `header` or `cookie`. apiKey: `user` or `password`. */
  in?: string;
  /** http: `bearer`, `basic`, … */
  scheme?: string;
  bearerFormat?: string;
  description?: string;
}

export type AuthSupport =
  /** The plugin can send it: a key in the query string. */
  | 'supported'
  /** Sendable only because the site configured a subprotocol to carry the token. */
  | 'via-subprotocol'
  /** The browser handles it on its own, if at all: cookies, client certificates. */
  | 'browser-managed'
  /** Needs something a browser WebSocket can't do, usually a header. */
  | 'unsupported'
  /** Broker-level auth (MQTT, Kafka, AMQP) that doesn't apply to WebSocket. */
  | 'not-applicable';

export interface AuthScheme extends SecuritySchemeInput {
  support: AuthSupport;
  /** What the scheme asks for, e.g. `API key in query parameter "token"`. */
  summary: string;
  /** Caveat or reason it can't be sent. */
  note?: string;
  /** For supported schemes: the query parameter the credential goes in. */
  queryParam?: string;
}

const NO_HEADERS = 'Browsers can’t send headers on a WebSocket handshake.';

const BROKER_TYPES = new Set([
  'userPassword',
  'apiKey',
  'plain',
  'scramSha256',
  'scramSha512',
  'gssapi',
  'symmetricEncryption',
  'asymmetricEncryption',
]);

export function classifyScheme(input: SecuritySchemeInput): AuthScheme {
  const { type } = input;

  if (type === 'httpApiKey') {
    const name = input.name ?? 'key';
    switch (input.in) {
      case 'query':
        return {
          ...input,
          support: 'supported',
          queryParam: name,
          summary: `API key in query parameter "${name}"`,
          note: 'Sent in the URL, which servers and proxies may log.',
        };
      case 'header':
        return { ...input, support: 'unsupported', summary: `API key in header "${name}"`, note: NO_HEADERS };
      case 'cookie':
        return {
          ...input,
          support: 'browser-managed',
          summary: `API key in cookie "${name}"`,
          note: 'Sent only if your browser already has this cookie for the server’s site. It can’t be set from here.',
        };
      default:
        return {
          ...input,
          support: 'unsupported',
          summary: `API key in ${input.in ?? 'an unspecified location'}`,
          note: 'Unknown location for the key.',
        };
    }
  }

  if (type === 'http') {
    const scheme = (input.scheme ?? '').toLowerCase();
    const label =
      scheme === 'bearer'
        ? `Bearer token${input.bearerFormat ? ` (${input.bearerFormat})` : ''}`
        : scheme === 'basic'
          ? 'HTTP Basic credentials'
          : `HTTP ${input.scheme ?? ''} credentials`.replace('  ', ' ');
    return { ...input, support: 'unsupported', summary: `${label} in the Authorization header`, note: NO_HEADERS };
  }

  if (type === 'oauth2' || type === 'openIdConnect') {
    return {
      ...input,
      support: 'unsupported',
      summary: `${type === 'oauth2' ? 'OAuth 2' : 'OpenID Connect'} access token`,
      note: `The token normally goes in the Authorization header. ${NO_HEADERS}`,
    };
  }

  if (type === 'X509') {
    return {
      ...input,
      support: 'browser-managed',
      summary: 'Client TLS certificate',
      note: 'Handled by the browser, which may ask you to choose a certificate.',
    };
  }

  if (BROKER_TYPES.has(type)) {
    return {
      ...input,
      support: 'not-applicable',
      summary: `${type} authentication`,
      note: 'Used by message brokers, not by WebSocket connections.',
    };
  }

  return {
    ...input,
    support: 'unsupported',
    summary: `${type} authentication`,
    note: 'Not a security scheme this plugin knows how to send.',
  };
}

export interface AuthPlan {
  /** Schemes to satisfy: the first alternative a browser can meet. Empty when there's none. */
  schemes: AuthScheme[];
  /** The spec allows connecting without credentials (no security, or an empty alternative). */
  optional: boolean;
  /** When no alternative can be met from a browser: the schemes standing in the way. */
  blockers: AuthScheme[];
}

const canSend = (scheme: AuthScheme) =>
  scheme.support === 'supported' || scheme.support === 'via-subprotocol' || scheme.support === 'browser-managed';

/** Schemes that are just a token, so a subprotocol could carry them if the server agrees. */
const canRideSubprotocol = (scheme: AuthScheme) =>
  scheme.support === 'unsupported' &&
  ((scheme.type === 'httpApiKey' && scheme.in === 'header') ||
    (scheme.type === 'http' && (scheme.scheme ?? '').toLowerCase() === 'bearer') ||
    scheme.type === 'oauth2' ||
    scheme.type === 'openIdConnect');

const SUBPROTOCOL_NOTE =
  'Sent as a WebSocket subprotocol, as configured by this site. If the server doesn’t accept it, the browser closes the connection.';

export interface PlanAuthOptions {
  /** The site configured a subprotocol to carry tokens, so token schemes become sendable (§8.2). */
  subprotocol?: boolean;
}

/**
 * Security requirements are alternatives: meeting any one is enough, and each needs all of its
 * schemes. An empty alternative makes auth optional.
 */
export function planAuth(
  alternatives: readonly (readonly AuthScheme[])[],
  { subprotocol = false }: PlanAuthOptions = {},
): AuthPlan {
  const considered = alternatives.map((alternative) =>
    alternative.map((scheme) =>
      subprotocol && canRideSubprotocol(scheme)
        ? { ...scheme, support: 'via-subprotocol' as const, note: SUBPROTOCOL_NOTE }
        : scheme,
    ),
  );

  const optional = considered.length === 0 || considered.some((alternative) => alternative.length === 0);
  const usable = considered.find((alternative) => alternative.length > 0 && alternative.every(canSend));
  if (usable) {
    return { schemes: [...usable], optional, blockers: [] };
  }

  const blockers = new Map<string, AuthScheme>();
  considered.flat().forEach((scheme) => {
    if (!canSend(scheme) && !blockers.has(scheme.id)) blockers.set(scheme.id, scheme);
  });
  return { schemes: [], optional, blockers: [...blockers.values()] };
}

/**
 * The URL to open, with credentials added for query-parameter schemes. The result contains
 * secrets: pass it to the socket and nowhere else (not the URL field, logs, keys or events).
 */
export function authorizeUrl(
  url: string,
  schemes: readonly AuthScheme[],
  credentialFor: (scheme: AuthScheme) => string | undefined,
): string {
  const withQueryKeys = schemes.filter((scheme) => scheme.support === 'supported' && scheme.queryParam);
  if (withQueryKeys.length === 0) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  let changed = false;
  for (const scheme of withQueryKeys) {
    const value = credentialFor(scheme);
    if (value) {
      parsed.searchParams.set(scheme.queryParam!, value);
      changed = true;
    }
  }
  return changed ? parsed.toString() : url;
}

const SENSITIVE_PARAM =
  /^(token|access_token|id_token|refresh_token|auth|authorization|api[-_]?key|key|secret|client_secret|password|passwd|pwd|signature|sig|jwt|session|sessionid)$/i;

export const REDACTED = '***';

/**
 * The URL with credential-looking query values and userinfo replaced, safe for events and logs.
 * Also redacts any `extraParams`, e.g. the query parameters of the server's security schemes.
 */
export function redactUrl(url: string, extraParams: readonly string[] = []): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  let changed = false;
  if (parsed.username || parsed.password) {
    parsed.username = parsed.username ? REDACTED : '';
    parsed.password = parsed.password ? REDACTED : '';
    changed = true;
  }
  for (const name of new Set(parsed.searchParams.keys())) {
    if (SENSITIVE_PARAM.test(name) || extraParams.includes(name)) {
      parsed.searchParams.set(name, REDACTED);
      changed = true;
    }
  }
  return changed ? parsed.toString() : url;
}

const SENSITIVE_KEY =
  /^(token|access[-_]?token|refresh[-_]?token|id[-_]?token|api[-_]?key|apikey|key|secret|client[-_]?secret|password|passwd|pwd|auth|authorization|credential|credentials|signature|sig|jwt|session|session[-_]?id)$/i;

const MASK_MAX_DEPTH = 8;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether a payload holds anything worth hiding. Cheaper than masking, so large frames without
 * secrets (an order book snapshot, say) are never copied.
 */
export function hasSecrets(value: unknown, depth = 0): boolean {
  if (depth > MASK_MAX_DEPTH) return false;
  if (Array.isArray(value)) return value.some((item) => hasSecrets(item, depth + 1));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => SENSITIVE_KEY.test(key) || hasSecrets(nested, depth + 1),
  );
}

/**
 * A copy of a payload with secret-looking values replaced, for display only. Application-level
 * auth puts credentials in messages (Kraken's `subscription.token`), and the log is shared with
 * anyone looking at the screen.
 */
export function maskSecrets(value: unknown, depth = 0): unknown {
  if (depth > MASK_MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => maskSecrets(item, depth + 1));
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      if (SENSITIVE_KEY.test(key) && nested !== null && typeof nested !== 'object') {
        return [key, REDACTED];
      }
      return [key, maskSecrets(nested, depth + 1)];
    }),
  );
}

/** Registry key for a credential: shared by every panel on the same server and scheme. */
export const credentialKey = (serverId: string, schemeId: string) => `${serverId} ${schemeId}`;
