import type { AuthOptions } from "./engine/registry";
import type { HostPattern } from "./engine/url";

export interface WsPluginOptions {
  /**
   * Hosts panels may connect to: `api.example.com` (any port), `localhost:8787` (that port),
   * `*.example.com` (subdomains only), or a RegExp tested against the host. Checked on every
   * connect, including edited URLs. Any host when omitted.
   */
  allowedHosts?: HostPattern[];
  /** Whether users may edit the URL resolved from the spec. Default true. */
  allowUrlEditing?: boolean;
  /**
   * Credentials the site supplies, and how to carry tokens a browser can't put in a header.
   * Both are opt-in; without them, only query-parameter keys can be sent, and they're typed in.
   */
  auth?: AuthOptions;
  /** How long to wait for the handshake before giving up. Default 10000. */
  connectTimeoutMs?: number;
  /** Frames retained per connection. Default 500. */
  maxFrames?: number;
  /**
   * Longest frame text kept in the log, in characters. Longer frames are truncated in the log
   * and not parsed; they are still sent and received in full. Default 1,000,000.
   */
  maxFrameLength?: number;
  /** Total frame text kept per connection, in characters. Default 10,000,000. */
  maxLogLength?: number;
}
