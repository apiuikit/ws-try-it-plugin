import { describe, expect, it } from "vitest";
import { bindingFields, queryValues, setQueryValue } from "./bindings";
import { toOperationIntent } from "./intent";

describe("handshake query parameters", () => {
  it("encodes edited values while preserving other query parameters and unresolved variables", () => {
    const url = setQueryValue(
      "wss://{host}/room/{id}?other=1&tag=a&tag=b",
      "search",
      "a&b + café"
    );
    expect(url).toContain("wss://{host}/room/{id}?");
    expect(queryValues(url).get("search")).toBe("a&b + café");
    expect(queryValues(url).getAll("tag")).toEqual(["a", "b"]);
    expect(queryValues(url).get("other")).toBe("1");
  });
  it("distinguishes removal from explicit empty values and replaces repeated values intentionally", () => {
    expect(setQueryValue("ws://localhost/?a=1&a=2", "a", "")).toBe(
      "ws://localhost/?a="
    );
    expect(setQueryValue("ws://localhost/?a=1", "a", undefined)).toBe(
      "ws://localhost/"
    );
    expect(setQueryValue("ws://localhost/#fragment", "a", "x")).toBe(
      "ws://localhost/?a=x#fragment"
    );
  });
  it("retains schema metadata, including false and zero choices", () => {
    expect(
      bindingFields({
        required: ["version"],
        properties: {
          version: {
            type: "integer",
            description: "Protocol version",
            enum: [0, 1],
          },
          flag: { enum: [false, true] },
        },
      })
    ).toEqual([
      {
        name: "version",
        required: true,
        type: "integer",
        description: "Protocol version",
        examples: ["0", "1"],
      },
      {
        name: "flag",
        required: false,
        type: undefined,
        description: undefined,
        examples: ["false", "true"],
      },
    ]);
  });
  it("resolves references at binding, query schema and property levels", () => {
    const ref = ($ref: string) => ({ $ref });
    const doc: any = {
      info: { title: "Test", version: "1" },
      servers: { ws: { host: "localhost", protocol: "ws" } },
      operations: {
        send: {
          action: "receive",
          channel: {
            address: "/",
            bindings: { ws: ref("#/components/channelBindings/ws") },
          },
        },
      },
      components: {
        channelBindings: {
          ws: {
            query: ref("#/components/schemas/query"),
            headers: { properties: { "X-Custom": { type: "string" } } },
            method: "POST",
          },
        },
        schemas: {
          query: {
            required: ["version"],
            properties: { version: ref("#/components/schemas/version") },
          },
          version: { type: "integer", default: 0 },
        },
      },
    };
    const intent = toOperationIntent({ document: doc, operationId: "send" })!;
    expect(intent.binding?.query[0]).toMatchObject({
      name: "version",
      required: true,
      type: "integer",
    });
    expect(intent.binding?.headers[0].name).toBe("X-Custom");
    expect(intent.binding?.method).toBe("POST");
    expect(intent.targets[0].url).toBe("ws://localhost/?version=0");
  });
});
