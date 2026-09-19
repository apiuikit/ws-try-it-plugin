import type { Frame } from './connection';
import type { MessageShape } from './routing';

/** A parsed `correlationId.location` runtime expression, e.g. `$message.payload#/reqid`. */
export interface CorrelationLocation {
  expression: string;
  source: 'payload' | 'header';
  /** Decoded JSON pointer segments. */
  tokens: string[];
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const EXPRESSION = /^\$message\.(payload|header)(?:#(.*))?$/;
const ARRAY_INDEX = /^(0|[1-9]\d*)$/;
const MAX_DEPTH = 8;

export function parseLocation(expression: string | undefined): CorrelationLocation | undefined {
  const match = expression ? EXPRESSION.exec(expression.trim()) : null;
  if (!expression || !match) return undefined;

  let pointer = match[2] ?? '';
  try {
    // The pointer sits in a URI fragment, so it may be percent-encoded.
    pointer = decodeURIComponent(pointer);
  } catch {
    return undefined;
  }
  if (pointer !== '' && !pointer.startsWith('/')) return undefined;

  const tokens =
    pointer === ''
      ? []
      : pointer
          .slice(1)
          .split('/')
          .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
  return { expression, source: match[1] as CorrelationLocation['source'], tokens };
}

export function readPointer(value: unknown, tokens: readonly string[]): unknown {
  let current = value;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      current = ARRAY_INDEX.test(token) ? current[Number(token)] : undefined;
    } else if (isObject(current) && Object.prototype.hasOwnProperty.call(current, token)) {
      current = current[token];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Returns a copy of `value` with `next` set at the pointer, creating objects along the way. */
export function writePointer(value: unknown, tokens: readonly string[], next: unknown): unknown {
  if (tokens.length === 0) return next;
  const [head, ...rest] = tokens;
  if (Array.isArray(value) && ARRAY_INDEX.test(head)) {
    const copy = value.slice();
    copy[Number(head)] = writePointer(copy[Number(head)], rest, next);
    return copy;
  }
  const base = isObject(value) ? value : {};
  return { ...base, [head]: writePointer(base[head], rest, next) };
}

/** The sub-schema describing the value at a pointer, looking through compositions. */
export function schemaAt(schema: unknown, tokens: readonly string[], depth = 0): unknown {
  if (tokens.length === 0) return schema;
  if (!isObject(schema) || depth > MAX_DEPTH) return undefined;

  const [head, ...rest] = tokens;
  const property = isObject(schema.properties) ? schema.properties[head] : undefined;
  if (property !== undefined) return schemaAt(property, rest, depth + 1);

  if (ARRAY_INDEX.test(head) && schema.items !== undefined) {
    const items = Array.isArray(schema.items) ? schema.items[Number(head)] : schema.items;
    return schemaAt(items, rest, depth + 1);
  }

  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    const parts = schema[keyword];
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const found = schemaAt(part, tokens, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** A new correlation id of the type the schema asks for. */
export function correlationValue(schema: unknown, seed: number): string | number {
  const type = isObject(schema) ? (Array.isArray(schema.type) ? schema.type[0] : schema.type) : undefined;
  return type === 'integer' || type === 'number' ? seed : `req-${seed}`;
}

/** Comparable form of a correlation id; ids are scalars, and 42 and "42" are different ids. */
export function correlationKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '' || typeof value === 'object') {
    return undefined;
  }
  return JSON.stringify(value);
}

/** JSON text with the correlation id set, or undefined when the text can't carry one. */
export function withCorrelationValue(
  text: string,
  location: CorrelationLocation,
  value: unknown,
): string | undefined {
  if (location.source !== 'payload' || location.tokens.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  return JSON.stringify(writePointer(parsed, location.tokens, value), null, 2);
}

export interface RequestCorrelation {
  /** Name of the correlation field, for display. */
  field: string;
  /** Undefined when the request carried no id. */
  key?: string;
  value?: unknown;
  replyFrameIds: number[];
  /** Time to the first reply. */
  latencyMs?: number;
}

export interface ReplyCorrelation {
  requestFrameId: number;
  field: string;
  value: unknown;
  latencyMs: number;
}

export interface CorrelationResult {
  /** Whether the operation's messages declare a payload correlation id at all. */
  enabled: boolean;
  /** Keyed by outbound frame id. */
  requests: Map<number, RequestCorrelation>;
  /** Keyed by inbound frame id. */
  replies: Map<number, ReplyCorrelation>;
  /** Inbound reply frames that carry an id, whether or not it matched one of our requests. */
  keyedInbound: Set<number>;
}

export interface CorrelateOptions {
  operationId: string;
  requestMessages: readonly MessageShape[];
  replyMessages: readonly MessageShape[];
  /** Message a frame was identified as, if any. */
  messageIdOf: (frame: Frame) => string | undefined;
}

const fieldName = (location: CorrelationLocation | undefined) =>
  location?.tokens[location.tokens.length - 1] ?? 'id';

function payloadLocations(messages: readonly MessageShape[]) {
  const byMessageId = new Map<string, CorrelationLocation>();
  const unique = new Map<string, CorrelationLocation>();
  for (const message of messages) {
    const location = parseLocation(message.correlationId);
    if (location?.source === 'payload' && location.tokens.length > 0) {
      byMessageId.set(message.id, location);
      unique.set(location.expression, location);
    }
  }
  return { byMessageId, all: [...unique.values()] };
}

function readKey(json: unknown, locations: readonly CorrelationLocation[]) {
  for (const location of locations) {
    const value = readPointer(json, location.tokens);
    const key = correlationKey(value);
    if (key !== undefined) return { location, key, value };
  }
  return undefined;
}

/**
 * Links an operation's requests to their replies by correlation id (PROJECT.MD §6). Derived
 * from the connection log, so it needs no state of its own. A reply goes to the most recent
 * earlier request with the same id.
 */
export function correlate(frames: readonly Frame[], options: CorrelateOptions): CorrelationResult {
  const request = payloadLocations(options.requestMessages);
  const reply = payloadLocations(options.replyMessages);
  const result: CorrelationResult = {
    enabled: request.all.length > 0,
    requests: new Map(),
    replies: new Map(),
    keyedInbound: new Set(),
  };
  if (!result.enabled) return result;

  const replyIds = new Set(options.replyMessages.map((message) => message.id));
  // Specs often declare the id on the request only; the reply usually echoes the same field.
  const replyFallback = reply.all.length > 0 ? reply.all : request.all;
  const latestByKey = new Map<string, { frame: Frame; state: RequestCorrelation }>();

  for (const frame of frames) {
    if (!frame.isJson) continue;
    const messageId = options.messageIdOf(frame);

    if (frame.direction === 'out') {
      if (frame.source !== options.operationId) continue;
      const own = messageId === undefined ? undefined : request.byMessageId.get(messageId);
      const locations = own ? [own] : request.all;
      const found = readKey(frame.json, locations);
      const state: RequestCorrelation = {
        field: fieldName(found?.location ?? locations[0]),
        key: found?.key,
        value: found?.value,
        replyFrameIds: [],
      };
      result.requests.set(frame.id, state);
      if (found) latestByKey.set(found.key, { frame, state });
      continue;
    }

    // Frames identified as something other than a reply (e.g. a heartbeat) are never replies.
    if (messageId !== undefined && !replyIds.has(messageId)) continue;
    const own = messageId === undefined ? undefined : reply.byMessageId.get(messageId);
    const found = readKey(frame.json, own ? [own] : replyFallback);
    if (!found) continue;

    result.keyedInbound.add(frame.id);
    const match = latestByKey.get(found.key);
    if (!match) continue;

    const latencyMs = frame.at - match.frame.at;
    match.state.replyFrameIds.push(frame.id);
    match.state.latencyMs ??= latencyMs;
    result.replies.set(frame.id, {
      requestFrameId: match.frame.id,
      field: fieldName(found.location),
      value: found.value,
      latencyMs,
    });
  }

  return result;
}
