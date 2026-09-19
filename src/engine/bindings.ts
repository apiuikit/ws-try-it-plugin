export interface BindingField {
  name: string;
  required: boolean;
  description?: string;
  type?: string;
  examples?: string[];
}
export interface HandshakeBinding {
  query: BindingField[];
  headers: BindingField[];
  method?: string;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function bindingFields(value: unknown): BindingField[] {
  const schema = record(value);
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(record(schema.properties)).map(([name, value]) => {
    const field = record(value);
    const suggestions = Array.isArray(field.enum)
      ? field.enum
      : Array.isArray(field.examples)
      ? field.examples
      : [];
    return {
      name,
      required: required.includes(name),
      description:
        typeof field.description === "string" ? field.description : undefined,
      type: typeof field.type === "string" ? field.type : undefined,
      examples: suggestions
        .filter((v) => ["string", "boolean", "number"].includes(typeof v))
        .map(String),
    };
  });
}

/** Work on the query alone so unresolved host/path variables remain editable. */
function parts(url: string) {
  const hashIndex = url.indexOf("#");
  const hash = hashIndex < 0 ? "" : url.slice(hashIndex);
  const rest = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const queryIndex = rest.indexOf("?");
  return {
    base: queryIndex < 0 ? rest : rest.slice(0, queryIndex),
    hash,
    query: new URLSearchParams(
      queryIndex < 0 ? "" : rest.slice(queryIndex + 1)
    ),
  };
}
export function queryValues(url: string): URLSearchParams {
  return parts(url).query;
}
/** Undefined removes a parameter; an empty string sends an explicit empty value. */
export function setQueryValue(
  url: string,
  name: string,
  value: string | undefined
): string {
  const { base, hash, query } = parts(url);
  if (value === undefined) query.delete(name);
  else query.set(name, value);
  const search = query.toString();
  return `${base}${search ? `?${search}` : ""}${hash}`;
}
