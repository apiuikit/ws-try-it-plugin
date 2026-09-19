import { describe, expect, it } from "vitest";
import type { AsyncAPIOperationPluginContext } from "apiuikit/plugin";
import { resolveRef, toOperationIntent } from "./intent";
const ref = ($ref: string) => ({ $ref });
function fixture() {
  return {
    asyncapi: "3.0.0",
    info: { title: "Echo", version: "1" },
    servers: {
      local: {
        host: "{host}:8787",
        protocol: "ws",
        pathname: "/api",
        variables: { host: { default: "localhost" } },
        security: [ref("#/components/securitySchemes/token")],
      },
    },
    channels: {
      echo: {
        address: "/{room}",
        parameters: { room: { examples: ["a b"] } },
        bindings: {
          ws: { query: { properties: { version: { default: 1 } } } },
        },
        messages: { ping: ref("#/components/messages/ping") },
      },
    },
    operations: {
      echo: {
        action: "receive",
        channel: ref("#/channels/echo"),
        messages: [ref("#/channels/echo/messages/ping")],
        reply: { channel: ref("#/channels/echo") },
      },
    },
    components: {
      messages: {
        ping: {
          name: "Ping",
          payload: ref("#/components/schemas/Ping"),
          examples: [{ payload: { type: "ping" } }],
          correlationId: { location: "$message.payload#/id" },
        },
      },
      schemas: {
        Ping: { type: "object", properties: { type: { const: "ping" } } },
      },
      securitySchemes: {
        token: { type: "httpApiKey", in: "query", name: "token" },
      },
    },
  };
}
const intent = (document: unknown) =>
  toOperationIntent({
    document,
    operationId: "echo",
  } as AsyncAPIOperationPluginContext);
describe("APIUIKIT document adapter", () => {
  it("resolves references, URLs, schemas, examples, auth and replies", () => {
    const doc = fixture(),
      result = intent(doc)!;
    expect(result.direction).toBe("clientSends");
    expect(result.targets[0].url).toBe(
      "ws://localhost:8787/api/a%20b?version=1"
    );
    expect(result.targets[0].security[0][0].queryParam).toBe("token");
    expect(result.messages[0].payloadSchema).toEqual(
      doc.components.schemas.Ping
    );
    expect(result.messages[0].example).toEqual({ type: "ping" });
    expect(result.replyMessages[0].id).toBe(result.messages[0].id);
    expect(result.routingMessages).toHaveLength(1);
  });
  it("honors anonymous operation security and channel server restrictions", () => {
    const doc: any = fixture();
    doc.operations.echo.security = [];
    expect(intent(doc)!.targets[0].security).toEqual([]);
    doc.channels.echo.servers = [];
    expect(intent(doc)).toBeUndefined();
    doc.channels.echo.servers = [ref("#/servers/local")];
    expect(intent(doc)!.targets).toHaveLength(1);
  });
  it("handles send direction and rejects unsupported operations", () => {
    const doc = fixture();
    doc.operations.echo.action = "send";
    expect(intent(doc)!.direction).toBe("clientReceives");
    doc.servers.local.protocol = "mqtt";
    expect(intent(doc)).toBeUndefined();
  });
  it("supports pointer escaping and terminates reference cycles", () => {
    expect(resolveRef({ "a/b": { "~c": 3 } }, ref("#/a~1b/~0c"))).toBe(3);
    expect(
      resolveRef({ a: ref("#/b"), b: ref("#/a") }, ref("#/a"))
    ).toBeUndefined();
    expect(resolveRef({}, ref("https://example.com/schema"))).toBeUndefined();
  });
});
