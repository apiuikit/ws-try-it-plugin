import type { AsyncAPIOperationPluginContext } from "apiuikit/plugin";
import { toClientDirection, type ClientDirection } from "./direction";
import {
  dedupeMessages,
  inferDiscriminator,
  type Discriminator,
  type MessageShape,
} from "./routing";
import { classifyScheme, type AuthScheme } from "./security";
import { bindingFields, type HandshakeBinding } from "./bindings";
import { buildTargetUrl, queryDefaults } from "./url";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v instanceof Map
    ? Object.fromEntries(v)
    : v && typeof v === "object" && !Array.isArray(v)
    ? (v as Obj)
    : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
export const WS_PROTOCOLS = new Set(["ws", "wss"]);
export interface ServerTarget {
  serverId: string;
  url: string;
  unresolved: string[];
  security: AuthScheme[][];
}
export interface OperationIntent {
  id: string;
  direction: ClientDirection;
  targets: ServerTarget[];
  messages: MessageShape[];
  replyMessages: MessageShape[];
  routingMessages: MessageShape[];
  discriminator?: Discriminator;
  binding?: HandshakeBinding;
}

/** Resolve document-local JSON pointers. External references must be resolved by the host. */
export function resolveRef(document: unknown, value: unknown): unknown {
  const seen = new Set<string>();
  while (typeof obj(value).$ref === "string") {
    const ref = obj(value).$ref as string;
    if (!ref.startsWith("#/") || seen.has(ref)) return undefined;
    seen.add(ref);
    try {
      value = decodeURIComponent(ref.slice(2))
        .split("/")
        .reduce<unknown>((node, key) => {
          key = key.replace(/~1/g, "/").replace(/~0/g, "~");
          const record = obj(node);
          return Object.prototype.hasOwnProperty.call(record, key)
            ? record[key]
            : undefined;
        }, document);
    } catch {
      return undefined;
    }
  }
  return value;
}

export function toOperationIntent({
  document,
  operationId,
}: AsyncAPIOperationPluginContext): OperationIntent | undefined {
  const resolve = (v: unknown) => obj(resolveRef(document, v));
  const traits = (v: unknown): Obj => {
    const own = resolve(v);
    return Object.assign({}, ...list(own.traits).map(resolve), own);
  };
  const operation = traits(obj(document.operations)[operationId]);
  let direction: ClientDirection;
  try {
    direction = toClientDirection(String(operation.action));
  } catch {
    return undefined;
  }
  const channel = resolve(operation.channel);
  if (!Object.keys(channel).length) return undefined;
  // Expand schema references for validation and example generation. Preserve cycles as refs.
  const schema = (v: unknown, seen = new Set<unknown>()): unknown => {
    if (!v || typeof v !== "object" || seen.has(v)) return v;
    const next = new Set(seen).add(v);
    const resolved = resolveRef(document, v);
    if (resolved !== v) return seen.has(resolved) ? v : schema(resolved, next);
    if (Array.isArray(v)) return v.map((x) => schema(x, next));
    return Object.fromEntries(
      Object.entries(obj(v)).map(([k, x]) => [k, schema(x, next)])
    );
  };
  const ids = new Map<unknown, string>();
  for (const [cid, c] of Object.entries(obj(document.channels))) {
    for (const [mid, m] of Object.entries(obj(resolve(c).messages)))
      ids.set(resolveRef(document, m), `${cid}/${mid}`);
  }
  const message = (v: unknown, fallback: string): MessageShape => {
    const raw = resolveRef(document, v);
    const m = traits(v);
    const payload = resolve(m.payload);
    const example = list(m.examples).find((x) =>
      Object.prototype.hasOwnProperty.call(obj(x), "payload")
    );
    return {
      id: ids.get(raw) ?? str(obj(v).$ref) ?? fallback,
      name: str(m.name) ?? str(m.title) ?? fallback,
      payloadSchema: schema(payload.schemaFormat ? payload.schema : m.payload),
      schemaFormat: str(payload.schemaFormat) ?? str(m.schemaFormat),
      example: obj(example).payload,
      correlationId: str(resolve(m.correlationId).location),
    };
  };
  const channelMessages = (c: Obj) =>
    Object.entries(obj(c.messages)).map(([id, v]) => message(v, id));
  const selected = (o: Obj, c: Obj) =>
    Array.isArray(o.messages)
      ? o.messages.map((v, i) => message(v, `message-${i + 1}`))
      : channelMessages(c);
  const security = (value: unknown): AuthScheme[][] =>
    list(value).map((v, i) => {
      const s = resolve(v);
      if (!s.type && !Object.keys(obj(v)).length) return []; // Explicit anonymous access.
      if (!s.type)
        return [
          classifyScheme({
            id: str(obj(v).$ref) ?? `unknown-${i}`,
            type: "unknown",
          }),
        ];
      return [
        classifyScheme({
          id:
            str(obj(v).$ref) ??
            [s.type, s.in, s.name, s.scheme].filter(Boolean).join(":") ??
            String(i),
          type: String(s.type),
          name: str(s.name),
          in: str(s.in),
          scheme: str(s.scheme),
          bearerFormat: str(s.bearerFormat),
          description: str(s.description),
        }),
      ];
    });
  const servers = Array.isArray(channel.servers)
    ? channel.servers.map(
        (v, i) => [str(obj(v).$ref) ?? String(i), resolve(v)] as const
      )
    : Object.entries(obj(document.servers)).map(
        ([id, v]) => [id, resolve(v)] as const
      );
  const values = (v: unknown) =>
    Object.fromEntries(
      Object.entries(obj(v)).map(([id, input]) => {
        const p = resolve(input),
          s = resolve(p.schema);
        const value =
          p.default ??
          s.default ??
          list(p.examples)[0] ??
          list(s.examples)[0] ??
          list(p.enum)[0] ??
          list(s.enum)[0];
        return [id, value == null ? undefined : String(value)];
      })
    );
  const binding = obj(schema(resolve(channel.bindings).ws));
  const targets = servers
    .filter(([, s]) => WS_PROTOCOLS.has(String(s.protocol).toLowerCase()))
    .map(([serverId, s]) => ({
      serverId,
      security: security(operation.security ?? s.security),
      ...buildTargetUrl({
        serverUrl:
          str(s.url) ??
          `${String(s.protocol).toLowerCase()}://${s.host ?? ""}${
            s.pathname ? `/${String(s.pathname).replace(/^\/+/, "")}` : ""
          }`,
        serverVariables: values(s.variables),
        address: str(channel.address),
        channelParameters: values(channel.parameters),
        query: queryDefaults(binding),
      }),
    }));
  if (!targets.length) return undefined;
  const reply = resolve(operation.reply),
    replyChannel = resolve(reply.channel);
  const messages = selected(operation, channel),
    replyMessages = selected(reply, replyChannel);
  const routingMessages = dedupeMessages([
    ...channelMessages(channel),
    ...channelMessages(replyChannel),
    ...messages,
    ...replyMessages,
  ]);
  return {
    binding: {
      query: bindingFields(binding.query),
      headers: bindingFields(binding.headers),
      method: str(binding.method),
    },
    id: operationId,
    direction,
    targets,
    messages,
    replyMessages,
    routingMessages,
    discriminator: inferDiscriminator(routingMessages),
  };
}
