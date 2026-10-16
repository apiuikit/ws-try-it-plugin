// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWsPlugin,
  createWsButtonPlugin,
  createWsHeaderButton,
} from "./plugin";
import { ConnectionRegistry } from "./engine/registry";
const viewer = vi.hoisted(() => ({ root: null as HTMLElement | null }));
vi.mock("apiuikit/plugin", () => ({
  definePlugin: (p: unknown) => p,
  useDocumentContext: () => ({
    portalHost: document.body,
    rootElement: viewer.root,
  }),
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  viewer.root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("panel lifecycle", () => {
  it("survives StrictMode replay and disposes once after unmount", async () => {
    const dispose = vi.spyOn(ConnectionRegistry.prototype, "dispose");
    const host = document.createElement("div");
    const root = createRoot(host);
    const Panel = createWsPlugin().slots["asyncapi.operation.tab"]!.component;
    const doc: any = {
      info: { title: "Echo", version: "1" },
      servers: { ws: { protocol: "ws", host: "localhost:8787" } },
      operations: {
        echo: { action: "receive", channel: { address: "/echo" } },
      },
    };
    await act(async () =>
      root.render(
        <StrictMode>
          <Panel document={doc} operationId="echo" />
        </StrictMode>
      )
    );
    expect(host.textContent).toContain("Connect");
    expect(dispose).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

it("opens an accessible modal, restores focus, and keeps the launcher mounted on Escape", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const Button =
    createWsButtonPlugin().slots["asyncapi.operation.reference.supplementary"]!;
  const doc: any = {
    info: { title: "Echo", version: "1" },
    servers: { ws: { protocol: "ws", host: "localhost:8787" } },
    operations: { echo: { action: "receive", channel: { address: "/echo" } } },
  };
  await act(async () =>
    root.render(<Button document={doc} operationId="echo" />)
  );
  const trigger = host.querySelector("button")!;
  trigger.focus();
  await act(async () => trigger.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement?.getAttribute("role")).toBe("dialog");
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    )
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await act(async () => root.unmount());
  host.remove();
});

describe("header button", () => {
  const doc = (servers: any): any => ({
    info: { title: "Echo", version: "1" },
    servers,
    operations: { echo: { action: "receive", channel: { address: "/echo" } } },
  });

  it("renders a Try It Out trigger that opens the modal", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const Header = createWsHeaderButton();
    await act(async () =>
      root.render(
        <Header
          document={doc({ ws: { protocol: "ws", host: "localhost:8787" } })}
          operationId="echo"
        />
      )
    );
    const trigger = host.querySelector("button")!;
    expect(trigger.textContent).toBe("Try It Out");
    await act(async () => trigger.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  it("renders nothing for an operation with no WebSocket server", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const Header = createWsHeaderButton();
    await act(async () =>
      root.render(
        <Header
          document={doc({ mq: { protocol: "amqp", host: "localhost:5672" } })}
          operationId="echo"
        />
      )
    );
    expect(host.innerHTML).toBe("");
    await act(async () => root.unmount());
  });
});

it("reuses the viewer registry after navigating away from every operation", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  viewer.root = host;
  const root = createRoot(host);
  const get = vi.spyOn(ConnectionRegistry.prototype, "get");
  const dispose = vi.spyOn(ConnectionRegistry.prototype, "dispose");
  const Panel = createWsPlugin().slots["asyncapi.operation.tab"]!.component;
  const channel = { address: "/room" };
  const doc: any = {
    info: { title: "Pub/sub", version: "1" },
    servers: { ws: { protocol: "ws", host: "localhost:8787" } },
    operations: {
      publish: { action: "receive", channel },
      subscribe: { action: "send", channel },
    },
  };
  try {
    await act(async () =>
      root.render(<Panel document={doc} operationId="publish" />)
    );
    const connection = get.mock.results[0].value;
    await act(async () => root.render(null));
    expect(dispose).not.toHaveBeenCalled();
    await act(async () =>
      root.render(<Panel document={doc} operationId="subscribe" />)
    );
    expect(get.mock.results.at(-1)!.value).toBe(connection);
    await act(async () => root.render(null));
    expect(dispose).not.toHaveBeenCalled();
    await act(async () => host.remove());
    expect(dispose).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("switches modal operations without reconnecting and retains drafts and keyboard navigation", async () => {
  const sockets: any[] = [];
  class Socket {
    binaryType = "blob";
    onopen: any = null;
    onmessage: any = null;
    onclose: any = null;
    onerror: any = null;
    send = vi.fn();
    close = vi.fn();
    constructor(readonly url: string) {
      sockets.push(this);
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const Header = createWsHeaderButton();
  const channel = { address: "/room" };
  const doc: any = {
    info: { title: "Pub/sub", version: "1" },
    servers: { ws: { protocol: "ws", host: "localhost:8787" } },
    operations: {
      publish: { title: "Publish a message", action: "receive", channel },
      subscribe: { title: "Receive room messages", action: "send", channel },
      broker: {
        action: "receive",
        channel: { servers: [{ protocol: "amqp", host: "localhost" }] },
      },
    },
  };
  try {
    await act(async () =>
      root.render(<Header document={doc} operationId="publish" />)
    );
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    await act(async () => trigger.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const tabs = dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    const editor = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )!.set!.call(editor, "saved draft");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      dialog.querySelector<HTMLButtonElement>(".aws-btn-primary")!.click()
    );
    await act(async () => sockets[0].onopen({}));
    await act(async () => tabs[1].click());
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(
      dialog.querySelector('[role="tabpanel"]:not([hidden])')!.textContent
    ).toContain("Connected");
    expect(sockets).toHaveLength(1);
    expect(sockets[0].close).not.toHaveBeenCalled();
    await act(async () =>
      tabs[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true })
      )
    );
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[0]);
    expect(editor.value).toBe("saved draft");
    // Revisit receive, then verify Tab wrapping ignores hidden publisher controls.
    await act(async () =>
      tabs[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true })
      )
    );
    expect(document.activeElement).toBe(tabs[1]);
    const visiblePanel = dialog.querySelector(
      '[role="tabpanel"]:not([hidden])'
    )!;
    const allTraffic =
      visiblePanel.querySelector<HTMLInputElement>(".aws-check input")!;
    allTraffic.focus();
    await act(async () =>
      allTraffic.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
      )
    );
    expect(document.activeElement).toBe(tabs[1]);
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    await act(async () => trigger.click());
    const selectedTab = document.querySelector(
      '[role="tab"][aria-selected="true"]'
    )!;
    expect(selectedTab.textContent).toContain("Publish a message");
    expect(selectedTab.textContent).not.toContain("/room");
    expect(selectedTab.getAttribute("title")).toBe("Send · publish · /room");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
