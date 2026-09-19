export interface MessageShape {
  /** Stable identity, shared by every reference to the same message. */
  id: string;
  name: string;
  payloadSchema?: unknown;
  /** Payload of the first example, if any. */
  example?: unknown;
  /** `correlationId.location` runtime expression, if any. */
  correlationId?: string;
  /** Media type of `payloadSchema`, e.g. `application/vnd.aai.asyncapi+json;version=3.0.0`. */
  schemaFormat?: string;
}

export interface Discriminator {
  property: string;
  /** JSON-encoded discriminator value → message id. */
  messageIdByValue: Map<string, string>;
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const NONE = Symbol('none');
const MAX_DEPTH = 8;

/** The single value a schema pins `property` to, looking through `allOf`/`oneOf`/`anyOf`. */
function constOf(schema: unknown, property: string, depth = 0): unknown {
  if (!isObject(schema) || depth > MAX_DEPTH) return NONE;

  const propertySchema = isObject(schema.properties) ? schema.properties[property] : undefined;
  if (isObject(propertySchema)) {
    if ('const' in propertySchema) return propertySchema.const;
    if (Array.isArray(propertySchema.enum) && propertySchema.enum.length === 1) {
      return propertySchema.enum[0];
    }
  }

  // Every allOf part applies, so any one of them can pin the value.
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      const value = constOf(part, property, depth + 1);
      if (value !== NONE) return value;
    }
  }

  // Only one oneOf/anyOf branch applies, so the branches must agree.
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const branches = schema[keyword];
    if (Array.isArray(branches) && branches.length > 0) {
      const values = branches.map((branch) => constOf(branch, property, depth + 1));
      const key = values[0] === NONE ? undefined : JSON.stringify(values[0]);
      if (key !== undefined && values.every((value) => value !== NONE && JSON.stringify(value) === key)) {
        return values[0];
      }
    }
  }

  return NONE;
}

function propertyNames(schema: unknown, names = new Set<string>(), depth = 0): Set<string> {
  if (!isObject(schema) || depth > MAX_DEPTH) return names;
  if (isObject(schema.properties)) {
    Object.keys(schema.properties).forEach((name) => names.add(name));
  }
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    const parts = schema[keyword];
    if (Array.isArray(parts)) {
      parts.forEach((part) => propertyNames(part, names, depth + 1));
    }
  }
  return names;
}

export function dedupeMessages(messages: MessageShape[]): MessageShape[] {
  const byId = new Map<string, MessageShape>();
  messages.forEach((message) => {
    if (!byId.has(message.id)) byId.set(message.id, message);
  });
  return [...byId.values()];
}

/**
 * Finds a payload property whose `const` (or single-value `enum`) tells the messages apart,
 * e.g. `type: ping | pong | tick` (PROJECT.MD §6, step 2).
 */
export function inferDiscriminator(messages: MessageShape[]): Discriminator | undefined {
  for (const property of propertyNames(messages[0]?.payloadSchema)) {
    const messageIdByValue = new Map<string, string>();
    const distinguishes = messages.every((message) => {
      const value = constOf(message.payloadSchema, property);
      if (value === NONE || typeof value === 'object') return false;
      const key = JSON.stringify(value);
      if (messageIdByValue.has(key)) return false;
      messageIdByValue.set(key, message.id);
      return true;
    });
    if (distinguishes) {
      return { property, messageIdByValue };
    }
  }
  return undefined;
}

/** The id of the message a parsed frame belongs to, if it can be told. */
export function matchFrame(json: unknown, discriminator: Discriminator | undefined): string | undefined {
  if (!discriminator || !isObject(json) || !(discriminator.property in json)) {
    return undefined;
  }
  return discriminator.messageIdByValue.get(JSON.stringify(json[discriminator.property]));
}
