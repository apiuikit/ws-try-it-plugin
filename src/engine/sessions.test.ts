// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { credentialKey } from "./security";
import { ViewerSessions } from "./sessions";
import type { WebSocketLike } from "./connection";

class Socket implements WebSocketLike {
  binaryType = "blob";
  onopen: WebSocketLike["onopen"] = null;
  onmessage: WebSocketLike["onmessage"] = null;
  onerror: WebSocketLike["onerror"] = null;
  onclose: WebSocketLike["onclose"] = null;
  send = vi.fn();
  close = vi.fn();
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(async () => {
  document.body.replaceChildren();
  await flush();
});
function setup() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const sockets: Socket[] = [];
  const sessions = new ViewerSessions({
    createSocket: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
    schedule: (run) => run(),
  });
  const doc = {};
  return { root, sockets, sessions, doc };
}

describe("viewer-owned WebSocket sessions", () => {
  it("keeps the socket, frames, credentials and drafts between unmounted operations", async () => {
    const { root, sockets, sessions, doc } = setup();
    const first = sessions.get(doc, root);
    const leave = sessions.retain(first);
    const connection = first.registry.get("wss://example.com/room");
    connection.connect();
    sockets[0].onopen?.({});
    first.registry.setDraft("publish:message", "draft");
    first.registry.setCredential("key", "secret");
    leave();
    await flush(); // No mounted operation; the document viewer remains.
    expect(sockets[0].close).not.toHaveBeenCalled();
    sockets[0].onmessage?.({ data: '{"event":"while-navigating"}' });
    const next = sessions.get(doc, root);
    const leaveNext = sessions.retain(next);
    expect(next).toBe(first);
    expect(
      next.registry.get("wss://example.com/room").getSnapshot().status
    ).toBe("open");
    expect(connection.getSnapshot().frames).toHaveLength(1);
    expect(next.registry.getDraft("publish:message")).toBe("draft");
    expect(next.registry.getCredential("key")).toBe("secret");
    expect(sockets).toHaveLength(1);
    leaveNext();
    root.remove();
    await flush();
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
    expect(first.abort.signal.aborted).toBe(true);
  });
  it("isolates two viewers rendering the same spec object", async () => {
    const { root, sessions, doc } = setup();
    const other = document.createElement("div");
    document.body.appendChild(other);
    const a = sessions.get(doc, root),
      b = sessions.get(doc, other);
    sessions.retain(a);
    sessions.retain(b);
    a.registry.setCredential("key", "secret");
    expect(b.registry.getCredential("key")).toBeUndefined();
    root.remove();
    await flush();
    expect(a.abort.signal.aborted).toBe(true);
    expect(b.abort.signal.aborted).toBe(false);
  });
  it("disposes a previous document when the viewer commits a different document", () => {
    const { root, sessions, doc } = setup();
    const a = sessions.get(doc, root);
    sessions.retain(a);
    const b = sessions.get({}, root);
    expect(a.abort.signal.aborted).toBe(false); // Merely rendering is not a commit.
    sessions.retain(b);
    expect(a.abort.signal.aborted).toBe(true);
    expect(b.abort.signal.aborted).toBe(false);
  });
  it("keeps its pagehide listener when no operation is mounted", async () => {
    const { root, sessions, sockets, doc } = setup();
    const session = sessions.get(doc, root);
    const leave = sessions.retain(session);
    session.registry.get("wss://example.com").connect();
    sockets[0].onopen?.({});
    leave();
    await flush();
    window.dispatchEvent(new Event("pagehide"));
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
  });
  it("survives effect replay and cleans up custom providers without a root", async () => {
    const sessions = new ViewerSessions({});
    const session = sessions.get({}, null);
    const leave = sessions.retain(session);
    leave();
    const leaveAgain = sessions.retain(session);
    await flush();
    expect(session.abort.signal.aborted).toBe(false);
    leaveAgain();
    await flush();
    expect(session.abort.signal.aborted).toBe(true);
  });
  it("aborts pending credentials on viewer removal while panels are closed", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    let finish!: (value: string) => void;
    let signal: AbortSignal | undefined;
    const sessions = new ViewerSessions({
      auth: {
        credentials: (request) => {
          signal = request.signal;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      },
    });
    const session = sessions.get({}, root);
    const leave = sessions.retain(session);
    session.registry.ensureCredentials("server", [
      {
        id: "token",
        type: "httpApiKey",
        support: "supported",
        summary: "Token",
        in: "query",
        name: "token",
      },
    ]);
    leave();
    await flush();
    expect(signal?.aborted).toBe(false);
    root.remove();
    await flush();
    expect(signal?.aborted).toBe(true);
    finish("late-secret");
    await flush();
    expect(
      session.registry.getCredential(credentialKey("server", "token"))
    ).toBeUndefined();
  });
});
