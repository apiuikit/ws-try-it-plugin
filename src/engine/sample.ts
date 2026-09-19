import type { MessageShape } from './routing';

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_DEPTH = 8;

/** A plausible value for a JSON schema, preferring values the schema states explicitly. */
export function sampleFromSchema(schema: unknown, depth = 0): unknown {
  if (!isObject(schema) || depth > MAX_DEPTH) return null;

  if ('const' in schema) return schema.const;
  if ('default' in schema) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const options = schema[keyword];
    if (Array.isArray(options) && options.length > 0) {
      return sampleFromSchema(options[0], depth + 1);
    }
  }

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce<JsonObject>((merged, part) => {
      const sample = sampleFromSchema(part, depth + 1);
      return isObject(sample) ? { ...merged, ...sample } : merged;
    }, {});
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (type === 'object' || isObject(schema.properties)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    // Optional fields are often only valid in some combinations (e.g. Kraken rejects `snapshot`
    // on a `book` subscription), so stick to the required ones when the schema lists them.
    const required = Array.isArray(schema.required) ? schema.required : undefined;
    return Object.fromEntries(
      Object.entries(properties)
        .filter(([name]) => required === undefined || required.includes(name))
        .map(([name, property]) => [name, sampleFromSchema(property, depth + 1)]),
    );
  }

  switch (type) {
    case 'array':
      return schema.items === undefined ? [] : [sampleFromSchema(schema.items, depth + 1)];
    case 'string':
      return schema.format === 'date-time' ? new Date().toISOString() : '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

/** Editor seed for a message: its first example, else a sample built from its schema. */
export function exampleText(message: MessageShape): string {
  const value = message.example !== undefined ? message.example : sampleFromSchema(message.payloadSchema);
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
