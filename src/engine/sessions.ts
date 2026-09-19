import { ConnectionRegistry, type RegistryOptions } from "./registry";

interface Session {
  document: object;
  root: HTMLElement | null;
  registry: ConnectionRegistry;
  abort: AbortController;
  users: number;
  disposed: boolean;
  stop?: () => void;
}

/** Own connections for the viewer's lifetime, independently of its operation panels. */
export class ViewerSessions {
  private scopes = new WeakMap<object, WeakMap<object, Session>>();
  private current = new WeakMap<HTMLElement, Session>();

  constructor(private readonly options: RegistryOptions) {}

  get(document: object, root: HTMLElement | null): Session {
    const scope = root ?? document;
    let documents = this.scopes.get(scope);
    if (!documents) {
      documents = new WeakMap();
      this.scopes.set(scope, documents);
    }
    let session = documents.get(document);
    if (!session || session.disposed) {
      const abort = new AbortController();
      session = {
        document,
        root,
        abort,
        registry: new ConnectionRegistry({
          ...this.options,
          signal: abort.signal,
        }),
        users: 0,
        disposed: false,
      };
      documents.set(document, session);
    }
    return session;
  }

  /** Called after commit: abandoned renders must not attach listeners or tear down a viewer. */
  retain(session: Session): () => void {
    const { root } = session;
    session.users++;
    if (root) {
      const previous = this.current.get(root);
      if (previous && previous !== session) this.dispose(previous);
      this.current.set(root, session);
    }
    if (!session.stop) {
      const view =
        root?.ownerDocument.defaultView ??
        (typeof window === "undefined" ? undefined : window);
      const hide = () => session.registry.closeAll();
      view?.addEventListener("pagehide", hide);
      // APIUIKIT has no plugin teardown hook. Its stable viewer root survives operation
      // navigation; watching removal also catches an ancestor/root being removed by React.
      const observer =
        root && view
          ? new view.MutationObserver(() => {
              if (!root.isConnected) this.dispose(session);
            })
          : undefined;
      if (root)
        observer?.observe(root.ownerDocument, {
          childList: true,
          subtree: true,
        });
      session.stop = () => {
        observer?.disconnect();
        view?.removeEventListener("pagehide", hide);
      };
    }
    return () => {
      session.users--;
      queueMicrotask(() => {
        // A mounted viewer owns the session even when no operation is open. Without
        // a viewer root (custom providers/SSR), retain the original panel cleanup.
        if (!session.users && !root?.isConnected) this.dispose(session);
      });
    };
  }

  private dispose(session: Session): void {
    if (session.disposed) return;
    session.disposed = true;
    session.stop?.();
    session.stop = undefined;
    session.abort.abort();
    session.registry.dispose();
    if (session.root && this.current.get(session.root) === session)
      this.current.delete(session.root);
  }
}
