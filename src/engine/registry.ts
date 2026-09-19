import { checkTarget, ConnectionManager, type ConnectionOptions } from './connection';
import { credentialKey, type AuthScheme } from './security';
import type { PrecheckResult } from './url';

export interface CredentialRequest {
  serverId: string;
  scheme: AuthScheme;
  /**
   * Aborted when the plugin is torn down. Pass it to `fetch()` so in-flight work stops, and
   * expect anything resolved after it aborts to be discarded.
   */
  signal?: AbortSignal;
}

export interface SubprotocolRequest {
  serverId: string;
  /** The target URL, without credentials. */
  url: string;
  /** Schemes to satisfy, including any marked `via-subprotocol`. */
  schemes: readonly AuthScheme[];
  /** The credential entered or provided for a scheme, if any. */
  credential: (scheme: AuthScheme) => string | undefined;
}

export interface AuthOptions {
  /**
   * Supplies a credential for a scheme, so signed-in users don't paste tokens. Called once per
   * server and scheme, and never overrides a value someone typed. May be async.
   */
  credentials?: (request: CredentialRequest) => string | undefined | Promise<string | undefined>;
  /**
   * Builds the subprotocols that carry a token, for servers that accept that. Opt-in: a server
   * selecting none of them makes the browser close the connection (PROJECT.MD §8.2).
   */
  subprotocol?: (request: SubprotocolRequest) => string[] | undefined;
}

export interface RegistryOptions extends ConnectionOptions {
  /** Whether users may edit the URL resolved from the spec. Default true. */
  allowUrlEditing?: boolean;
  auth?: AuthOptions;
  /**
   * The library's `PluginAPI.signal`, aborted when the plugin is unregistered or the component
   * unmounts. Handed to the credentials provider, and used to ignore late results.
   */
  signal?: AbortSignal;
}

/**
 * Plugin-lifetime state shared by every panel: one connection per URL (PROJECT.MD §4), plus
 * the bits of panel state that must survive a panel unmounting.
 */
export class ConnectionRegistry {
  private readonly connections = new Map<string, ConnectionManager>();
  private readonly urlOverrides = new Map<string, string>();
  private readonly drafts = new Map<string, string>();
  /** Credentials by `credentialKey(server, scheme)`. Memory only: never persisted or published. */
  private readonly credentials = new Map<string, string>();
  /** Credentials the site supplied, rather than someone typing them. */
  private readonly providedCredentials = new Set<string>();
  /** Keys already asked of the site, so a provider is called once even while panels re-render. */
  private readonly requestedCredentials = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private correlationSeed = 0;

  constructor(private readonly options: RegistryOptions = {}) {}

  get allowUrlEditing(): boolean {
    return this.options.allowUrlEditing ?? true;
  }

  get(url: string): ConnectionManager {
    let connection = this.connections.get(url);
    if (!connection) {
      connection = new ConnectionManager(url, this.options);
      this.connections.set(url, connection);
    }
    return connection;
  }

  /** Whether a URL may be connected to, and if not, why. */
  check(url: string): PrecheckResult {
    return checkTarget(url, this.options);
  }

  /** Subscribes to URL override changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  /** The URL panels should use for a resolved target, after any user edit. */
  resolveUrl(defaultUrl: string): string {
    if (!this.allowUrlEditing) return defaultUrl;
    return this.urlOverrides.get(defaultUrl) ?? defaultUrl;
  }

  setUrlOverride(defaultUrl: string, url: string): void {
    if (!this.allowUrlEditing) return;
    if (url === defaultUrl) {
      this.urlOverrides.delete(defaultUrl);
    } else {
      this.urlOverrides.set(defaultUrl, url);
    }
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  getCredential(key: string): string | undefined {
    return this.credentials.get(key);
  }

  /** Shared by every panel on the same server, so a change re-renders them all. */
  setCredential(key: string, value: string): void {
    this.providedCredentials.delete(key);
    this.store(key, value);
  }

  /** Whether the site supplied this credential, rather than someone typing it. */
  isProvidedCredential(key: string): boolean {
    return this.providedCredentials.has(key);
  }

  /** Whether the site configured a subprotocol carrier, which makes token schemes sendable. */
  get subprotocolAuthEnabled(): boolean {
    return typeof this.options.auth?.subprotocol === 'function';
  }

  /** Asks the site for any credentials not already entered. Safe to call on every render. */
  ensureCredentials(serverId: string, schemes: readonly AuthScheme[]): void {
    const provider = this.options.auth?.credentials;
    const { signal } = this.options;
    if (!provider || signal?.aborted) return;

    for (const scheme of schemes) {
      const key = credentialKey(serverId, scheme.id);
      if (this.credentials.has(key) || this.requestedCredentials.has(key)) continue;
      this.requestedCredentials.add(key);
      try {
        Promise.resolve(provider({ serverId, scheme, signal }))
          .then((value) => {
            // The plugin may have been torn down, or someone may have typed a credential,
            // while the provider was working.
            if (signal?.aborted) return;
            if (typeof value === 'string' && value !== '' && !this.credentials.has(key)) {
              this.providedCredentials.add(key);
              this.store(key, value);
            }
          })
          .catch((error) => console.warn('[asyncapi-ws-plugin] credentials provider failed', error));
      } catch (error) {
        console.warn('[asyncapi-ws-plugin] credentials provider failed', error);
      }
    }
  }

  /** Subprotocols to offer for a target, or undefined when the site configured none. */
  subprotocolsFor(serverId: string, url: string, schemes: readonly AuthScheme[]): string[] | undefined {
    const build = this.options.auth?.subprotocol;
    if (!build) return undefined;
    try {
      const protocols = build({
        serverId,
        url,
        schemes,
        credential: (scheme) => this.getCredential(credentialKey(serverId, scheme.id)),
      });
      return protocols && protocols.length > 0 ? protocols : undefined;
    } catch (error) {
      console.warn('[asyncapi-ws-plugin] subprotocol builder failed', error);
      return undefined;
    }
  }

  private store(key: string, value: string): void {
    if (value === '') {
      this.credentials.delete(key);
    } else {
      this.credentials.set(key, value);
    }
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  getDraft(key: string): string | undefined {
    return this.drafts.get(key);
  }

  setDraft(key: string, text: string): void {
    this.drafts.set(key, text);
  }

  /** Increasing seed for generated correlation ids, shared so panels don't reuse each other's. */
  nextCorrelationSeed(): number {
    return ++this.correlationSeed;
  }

  closeAll(): void {
    this.connections.forEach((connection) => connection.disconnect());
  }

  dispose(): void {
    this.connections.forEach((connection) => connection.dispose());
    this.connections.clear();
    this.credentials.clear();
    this.providedCredentials.clear();
    this.requestedCredentials.clear();
    this.listeners.clear();
  }
}
