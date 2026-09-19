import { createWsHeaderButton } from "./plugin";

export {
  createWsPlugin,
  createWsButtonPlugin,
  createWsHeaderButton,
  PLUGIN_NAME,
} from "./plugin";
/** The header trigger apiuikit renders built-in, with default options. */
export const WsHeaderButton = createWsHeaderButton();
export type { WsPluginOptions } from "./types";
export { toClientDirection } from "./engine/direction";
export type { ClientDirection } from "./engine/direction";
export type {
  ConnectionStatus,
  ConnectionSnapshot,
  Frame,
} from "./engine/connection";
export type { HostPattern } from "./engine/url";
export type {
  AuthOptions,
  CredentialRequest,
  SubprotocolRequest,
} from "./engine/registry";
export type { AuthScheme, AuthSupport } from "./engine/security";
