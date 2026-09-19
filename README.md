# @apiuikit/ws-try-it-plugin

WebSocket “Try it” panels for APIUIKIT. Adapted from `asyncapi-ws-plugin`, with the same connection engine, message composer, validation, frame log, routing and correlation support.

## Use in APIUIKIT

Build this checkout, then install it into your application:

```sh
# In this directory
npm install
npm run build

# In your application (adjust the relative path)
npm install ../ws-try-it-plugin
```

```tsx
import { AsyncAPI } from 'apiuikit';
import 'apiuikit/style.css';
import { createWsPlugin } from '@apiuikit/ws-try-it-plugin';

// Create once, outside render.
const plugins = [createWsPlugin()];

export function Docs({ schema }) {
  return <AsyncAPI asyncapi={schema} plugins={plugins} />;
}
```

`createWsPlugin()` fills `asyncapi.operation.tab`. To use a button that opens a modal from the Reference panel instead:

```tsx
import { createWsButtonPlugin } from '@apiuikit/ws-try-it-plugin';
const plugins = [createWsButtonPlugin()];
```

The modal includes operation tabs when the document has multiple WebSocket operations. Switch between Send and Receive operations without closing it. Tabs use operation titles (falling back to summaries or IDs), support Arrow Left/Right and Home/End, and preserve visited panels’ drafts, server selections and log filters. Connections are reused when operations resolve to the same URL. Reopening starts at the operation whose Try It Out button you clicked.

These factories register independently, matching the OpenAPI Try It plugin. They can coexist, but each factory owns its own connection state. The modal supports Escape, focus trapping and focus restoration. Panels use APIUIKIT's theme variables; no extra stylesheet import is needed. The UI follows the OpenAPI Try It panel: a URL header, full-width Send action, and a wide modal with independently scrolling composer and message columns. Narrow modals stack these sections vertically.

Requires APIUIKIT ≥1.7 and React/React DOM ≥18. This package has no dependency on `@asyncapi/react-component` or its plugin API.

## Features

- Connect/disconnect, server selection, editable URLs and handshake timeout.
- Query-parameter editor in the left panel, populated from `channel.bindings.ws.query`, with include toggles, required markers, suggestions, and custom parameters. Edits update the handshake URL; disconnect before editing. `allowUrlEditing: false` locks both the URL and these fields.
- Handshake headers are listed with the browser limitation; non-GET bindings show an explanation and disable Connect.
- AsyncAPI 3.x plain document data, local JSON-pointer references, operation/message traits, server variables, channel parameters and WebSocket query defaults.
- Client send/receive direction derived from the application's operation action.
- Examples or schema-generated message drafts, live JSON Schema validation and deliberately invalid sends.
- Bounded frame log, message matching, reply correlation and unmatched-frame visibility.
- Query API keys, optional credential providers and optional authentication via subprotocols. Credentials stay in memory.

External references should be resolved by the host before rendering. Recursive schema references and non-JSON schema formats may be reported as unsupported for validation. Raw AsyncAPI 2.x documents must first be normalized to APIUIKIT's operation-based document shape.

## Options

```tsx
createWsPlugin({
  allowedHosts: ['localhost:8787', '*.example.com'],
  allowUrlEditing: true,
  connectTimeoutMs: 10_000,
  maxFrames: 500,
  maxFrameLength: 1_000_000,
  maxLogLength: 10_000_000,
  auth: {
    credentials: async ({ serverId, scheme, signal }) => {
      // Return a credential from your application's session, or undefined.
      return undefined;
    },
    // Optional, only when supported by your server:
    // subprotocol: ({ schemes, credential }) => ['my-protocol', credential(schemes[0])!],
  },
});
```

All options are optional. Hosts are unrestricted and URL editing is enabled by default. The limits above are the defaults. Both factories accept the same `WsPluginOptions`.

Connections, frames, credentials and drafts belong to the APIUIKIT document viewer, rather than its operation panels. Closing a modal or navigating between operations preserves the session, including messages received while no operation is open. Operations using the same URL reuse the connection. Disconnect explicitly to end it; removing the viewer closes its connections and aborts pending credential requests. Page navigation also closes connections. Viewers and plugin instances are isolated, even when they render the same document object. A new document committed by a panel replaces the previous session for that viewer.

APIUIKIT currently exposes no plugin teardown hook, so cleanup observes removal of its `rootElement`. Custom providers without a root retain panel-unmount cleanup. Removing just a plugin while keeping its viewer mounted leaves its session alive until that viewer is removed or the page is left.

The WebSocket binding describes the connection handshake, not the contents of each message. Query values are sent when connecting. Array/object serialization is server-specific: enter the expected wire value directly, or edit the URL for repeated keys. Authentication query credentials from Authorization are applied at connection time and take precedence over matching query fields.

Browser WebSockets cannot set arbitrary handshake headers. Configure your server for browser-compatible authentication, allow its host in CSP `connect-src`, and use `wss` on HTTPS pages.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

The dev dependency points to `../../Hands-on/apiuikit/packages/lib`, matching the sibling OpenAPI plugin's local workflow. Consumers receive a normal APIUIKIT peer dependency. Build output includes ESM, CommonJS and TypeScript declarations. Node 20.19+ is supported by the development tools.

[examples/echo.json](examples/echo.json) is a small AsyncAPI 3 document for a local echo server on port 8787. It does not start a server.

The engine and UI were ported from the Apache-2.0 licensed sibling `asyncapi-ws-plugin`; its original architecture notes are retained in [PROJECT.MD](PROJECT.MD). The APIUIKIT integration and lifecycle described above supersede the original install/uninstall design.

### Local CommonJS check

The plugin emits CommonJS successfully, but loading it with `require()` currently fails in the sibling APIUIKIT checkout: `dist/apiuikit.cjs.js` cannot resolve its `index-yokZpB60.cjs` chunk. ESM imports pass. The host package's CommonJS build needs correcting before this checkout can be validated in a CommonJS consumer.

### PieHost pub/sub example

Load [examples/piehost.yaml](examples/piehost.yaml) or [examples/piehost.json](examples/piehost.json) in APIUIKIT. This AsyncAPI 3.0 contract uses the public key and C2C-enabled demo described in [PieHost's chat example](https://piehost.com/docs/3.0/websocket-example).

1. Open `publishMessage`, connect, and send the provided JSON example.
2. Enable **All traffic** to see the broadcast returned to the same connection (`notify_self=1`). Broadcasts are not modeled as request/reply responses.
3. Open `receiveMessages` in a second browser tab and connect to the same room. Publish from the first tab to verify delivery.
4. Disconnect the publishing tab, omit `notify_self` using its checkbox, and reconnect: the other tab still receives the message, but the sender does not.

The room defaults to `apiuikit-test`. Change the room in the connection URL in both tabs to isolate your test. `api_key`, `notify_self`, and optional `user` appear in the query editor. For your own account, replace the cluster host and API key and enable C2C messaging. See [PieHost's connection options](https://piehost.com/docs/3.0/websocket-api).

The spec was validated with the AsyncAPI parser; the public demo's availability was not live-tested.
