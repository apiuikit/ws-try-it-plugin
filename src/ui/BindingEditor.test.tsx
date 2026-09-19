// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ConnectionRegistry } from "../engine/registry";
import { toOperationIntent } from "../engine/intent";
import { OperationPanel } from "./OperationPanel";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function setup(allowUrlEditing = true, method = "GET") {
  const doc: any = {
    info: { title: "Echo", version: "1" },
    servers: { ws: { protocol: "ws", host: "localhost:8787" } },
    operations: {
      echo: {
        action: "receive",
        channel: {
          address: "/echo",
          bindings: {
            ws: {
              method,
              query: {
                required: ["version"],
                properties: { version: { type: "integer", default: 1 } },
              },
            },
          },
        },
      },
    },
  };
  const sockets: any[] = [];
  const registry = new ConnectionRegistry({
    allowUrlEditing,
    createSocket: (url) => {
      const socket: any = {
        url,
        binaryType: "blob",
        send() {},
        close() {},
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      };
      sockets.push(socket);
      return socket;
    },
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const intent = toOperationIntent({ document: doc, operationId: "echo" })!;
  await act(async () =>
    root.render(
      <OperationPanel intent={intent} registry={registry} layout="split" />
    )
  );
  return {
    host,
    sockets,
    registry,
    cleanup: async () => {
      await act(async () => root.unmount());
      registry.dispose();
      host.remove();
    },
  };
}

describe("binding editor connection behavior", () => {
  it("sends edited query values in the handshake and locks editing while connected", async () => {
    const view = await setup();
    try {
      const input = view.host.querySelector<HTMLInputElement>(
        ".aws-binding-field .aws-input"
      )!;
      expect(input.value).toBe("1");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )!.set!.call(input, "42");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(
        view.host.querySelector<HTMLInputElement>(
          '[aria-label="WebSocket URL"]'
        )!.value
      ).toContain("version=42");
      await act(async () =>
        view.host.querySelector<HTMLButtonElement>(".aws-btn-primary")!.click()
      );
      expect(view.sockets[0].url).toBe("ws://localhost:8787/echo?version=42");
      expect(input.disabled).toBe(true);
      await act(async () => view.sockets[0].onopen({}));
      expect(input.disabled).toBe(true);
      await act(async () =>
        view.sockets[0].onclose({ code: 1000, reason: "", wasClean: true })
      );
      expect(input.disabled).toBe(false);
    } finally {
      await view.cleanup();
    }
  });
  it("omits unchecked parameters and restores their values on re-enabling", async () => {
    const view = await setup();
    try {
      const checkbox = view.host.querySelector<HTMLInputElement>(
        '[aria-label="Include version"]'
      )!;
      const url = view.host.querySelector<HTMLInputElement>(
        '[aria-label="WebSocket URL"]'
      )!;
      await act(async () => checkbox.click());
      expect(url.value).toBe("ws://localhost:8787/echo");
      await act(async () => checkbox.click());
      expect(url.value).toContain("version=1");
    } finally {
      await view.cleanup();
    }
  });
  it("respects disabled URL editing", async () => {
    const view = await setup(false);
    try {
      expect(
        view.host.querySelector<HTMLInputElement>(
          ".aws-binding-field .aws-input"
        )!.disabled
      ).toBe(true);
      expect(
        view.host.querySelector<HTMLInputElement>(
          '[aria-label="Include version"]'
        )!.disabled
      ).toBe(true);
    } finally {
      await view.cleanup();
    }
  });
  it("explains and blocks a handshake method the browser cannot send", async () => {
    const view = await setup(true, "POST");
    try {
      expect(view.host.textContent).toContain("Browser WebSockets use GET");
      expect(
        view.host.querySelector<HTMLButtonElement>(".aws-btn-primary")!.disabled
      ).toBe(true);
    } finally {
      await view.cleanup();
    }
  });
});
