# Live WebSocket Execution Plugin — Implementation Breakdown

Working document for [asyncapi-react#1299](https://github.com/asyncapi/asyncapi-react/issues/1299).
Targets the plugin architecture introduced in [#1185](https://github.com/asyncapi/asyncapi-react/pull/1185).

---

## 1. What the plugin API gives us today

From #1185:

```ts
const plugin: AsyncApiPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  install(api: PluginAPI) {
    api.registerComponent(PluginSlot.OPERATION, MyComponent, { priority: 150 });
    api.on('event-name', (data) => console.log(data));
  }
};

<AsyncApi schema={schema} plugins={[plugin]} />
```

Available:

- `AsyncApiPlugin` interface — `name`, `version`, `install(api)`
- `api.registerComponent(slot, Component, { priority })` — higher priority renders first
- `api.on` / `api.off` / `api.emit` — event bus, framed as inter-plugin communication
- Runtime register/unregister
- `PluginSlot.OPERATION`

Two properties of this shape matter for WebSocket work:

1. `install()` runs once per plugin instance. Its closure is the natural home for state that must outlive any rendered component.
2. Registered components mount and unmount freely as the user scrolls, expands, and collapses. **Nothing owned by a slot component can be trusted to persist.**

---

## 2. Core changes required before the plugin can be self-contained

These are library changes, not plugin changes. Each maps to an acceptance criterion in #1299.

### 2.1 A document-level slot (blocking)

`PluginSlot.OPERATION` is the only registration target. A WebSocket tester has two UI surfaces:

| Surface | Scope | Slot needed |
|---|---|---|
| Send/receive panel | Per operation | `OPERATION` ✅ |
| Connection bar — server picker, auth, connect/disconnect, status | Per document | ❌ none exists |

Without a root slot, the AC *"visible connection-status indicator"* has nowhere to render inside the plugin. The alternatives are both bad: render outside `<AsyncApi>` (plugin is no longer self-contained, defeating `plugins={[...]}`), or register into the first operation (arbitrary, breaks on filtered views).

**Proposal:** add `PluginSlot.DOCUMENT` (or `ROOT`). Optionally `PluginSlot.SERVER` and `PluginSlot.MESSAGE` later — only `DOCUMENT` is load-bearing for this issue.

### 2.2 Widen the slot component props contract (blocking)

Resolving a WebSocket connection requires data that does not live on the operation:

- **Server** — protocol, host, pathname, variables
- **Channel bindings** — in the `ws` binding, `query` / `headers` / `method` are **channel-level**, not operation-level
- **Security schemes** — document-level components

> Note for the issue text: the AC currently reads *"using the operation's WS/WSS bindings."* In 3.0 an operation references a channel and the binding sits on the channel. Suggest rewording to *"the channel's WS/WSS bindings."*

An `OPERATION` slot component therefore needs at minimum `{ operation, channel, document }`, or a resolver helper on `PluginAPI`.

### 2.3 A teardown counterpart to `install` (blocking)

AC: *"Connections are cleanly torn down when the user navigates away or unmounts the component, to avoid orphaned sockets."*

Unregistration exists, but the plugin must be **told** it is going away so it can `close()` its sockets. Needs `uninstall(api)` / `dispose()` on the `AsyncApiPlugin` interface, called on unregister and on `<AsyncApi>` unmount.

**Built.** `AsyncApiPlugin.uninstall?(api)` receives the same `PluginAPI` that `install()` got; `PluginManager.unregister()` removes the plugin's components and listeners then calls it; a new `PluginManager.destroy()` runs on `<AsyncApi>` unmount; a plugin cancelled mid-install is uninstalled too. The plugin's `pagehide` listener stays, for the page going away without React unmounting.

### 2.4 Known bug in the OPERATION slot

Flagged in #1185 review, in `library/src/containers/Operations/Operation.tsx` (~line 235):

```tsx
{PluginManager && (   // imported class — always truthy
```

Intent was the `pluginManager` instance. This is the exact slot the WS plugin renders into, and it masks the unregistered-plugin case — which contradicts AC *"Existing Playground behavior is unaffected when no plugin is registered."* Confirm fixed before building on it.

---

## 3. Recommendation: do not add protocol lifecycle hooks to `PluginAPI`

The Notes section of #1299 proposes that the plugin architecture needs `onOpen` / `onMessage` / `onClose` / `onError` rather than a single call/response hook. Recommend against.

**Why.** Those four are the lifecycle of a *resource the plugin owns*, not of a plugin. Putting them in `PluginAPI` makes the core aware of connection semantics. The next protocol then wants its own: MQTT needs QoS and subscription acks, Kafka needs partitions and consumer groups, AMQP needs exchange/queue binding. The "protocol-agnostic" hook set accumulates a tail of protocol-specific concepts, and the plugin pattern never actually gets validated — the first protocol just gets special-cased into core.

**What to do instead.** The existing bus already carries this:

```ts
// inside the WS plugin — core knows nothing about WebSocket
api.emit('ws:open',    { serverId, url });
api.emit('ws:closed',  { serverId, code, reason, wasClean });
api.emit('ws:error',   { serverId, kind });
api.emit('ws:traffic', { serverId, direction, count }); // coarse, see §7
```

Other plugins subscribe with `api.on`. Follow-up protocols (MQTT, AMQP, Kafka) need **zero** core changes — they emit their own namespaced events.

**The real framework need underneath that note** is different: somewhere for long-lived state to live, and a teardown signal. `install()` closure + §2.3 covers both.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────┐
│ install(api)                     ← runs once, owns state │
│                                                          │
│   IntentModel      normalized operations (§5)            │
│   ConnectionRegistry  Map<serverId, ConnectionManager>   │
│   ValidatorCache   Map<messageId, cfworker Validator>    │
│                                                          │
│   api.registerComponent(DOCUMENT,  ConnectionBar)        │
│   api.registerComponent(OPERATION, OperationPanel)       │
└──────────────────────────────────────────────────────────┘
                          │
        components subscribe via useSyncExternalStore
                          │
┌──────────────────────────────────────────────────────────┐
│ ConnectionBar          OperationPanel × N                │
│ (document slot)        (operation slot, mount/unmount)   │
└──────────────────────────────────────────────────────────┘
```

**One socket per server, not per operation.** Keyed by resolved URL in `ConnectionRegistry`. Per-operation sockets would multiply handshakes, multiply auth prompts, and push against browser per-host connection caps (~200 in Firefox, similar in Chromium).

**State lives outside React.** `ConnectionManager` is a plain class with `subscribe(listener)` / `getSnapshot()`. Components read it through `useSyncExternalStore`. This is what lets panels unmount without killing the socket, and avoids re-rendering the whole document on every frame.

---

## 5. Direction normalization (do this at the parser boundary)

The single most common bug in tooling of this kind. Both spec versions define direction from the **application's** perspective, which reads backwards from the test client's:

| Spec | Field | Application does | Test client does |
|---|---|---|---|
| 2.x | `publish` | receives | **sends** |
| 2.x | `subscribe` | sends | **receives** |
| 3.0 | `action: receive` | receives | **sends** |
| 3.0 | `action: send` | sends | **receives** |

Normalize once into an intent model and never touch the raw fields again:

```ts
interface IntentOperation {
  id: string;
  direction: 'clientSends' | 'clientReceives';
  channelId: string;
  messages: IntentMessage[];
  reply?: ReplySpec;        // 3.0 operation.reply
  correlationId?: string;   // runtime expression
}
```

`@asyncapi/parser` handles $ref resolution, defaults, and validation. Payload schemas default to AsyncAPI Schema (a Draft-07 superset), validated with `@cfworker/json-schema` in draft-7 mode (§8.7 explains why not Ajv). Other `schemaFormat` values (Avro, Protobuf, OpenAPI) require the matching parser plugin or an explicit "unsupported schema format" state in the panel.

---

## 6. Inbound frame routing

WebSocket has no native topic. A spec typically models one channel as the whole connection, multiplexing many messages over it via a discriminator field (`type`, `event`, `op` — the spec does not say which). Resolution order:

1. **Explicit config** — plugin option or `x-` extension naming the discriminator. Always support as an escape hatch.
2. **Inference** — find a property with a `const` or single-value `enum` common across the message set. Catches most real specs.
3. **Validate-against-all** — try every candidate schema, take the match. Correct but O(messages) per frame and ambiguous when schemas overlap. Fallback only.

Frames matching nothing go to the log tagged `unmatched` — not dropped. That surfaces spec drift, which is arguably the most valuable thing this feature produces.

### Request/reply correlation

This is the feature that justifies building the tester *into the docs* rather than telling people to use Postman.

- **3.0:** `operation.reply` states the reply channel/address explicitly. Use it when present.
- **Both:** `correlationId.location` is a runtime expression — `$message.header#/correlationId`, `$message.payload#/requestId`. Implement an evaluator for these, extract on send, match on receive.

UI: a send transitions `pending → matched`, with the reply rendered inline in the same panel. Read-the-docs and exercise-the-API collapse into one motion.

---

## 7. Performance

The *"live, scrollable message log"* AC is the one most likely to pass review against a demo server and fall over on a real feed.

- **Never emit per frame on the bus.** Coarse events only (§3). Per-frame `emit` into React subscribers will melt the page at a few hundred msg/s.
- **Ring buffer outside React**, flushed on `requestAnimationFrame`. Cap retained history (configurable, default ~500).
- **Virtualize the log list.**
- **Build validators once**, cached by message id. Never per frame. A Gemini update validates in ~36 µs with all errors (~12 µs stopping at the first), about 0.5% of a core at ~135 msg/s (§8.7).
- `binaryType = 'arraybuffer'` at construction — the default is `"blob"` and forces async reads.

---

## 8. Browser constraints

The environment removes capabilities the spec assumes. Each of these needs a defined UI state rather than an opaque failure.

### 8.1 Hard blockers

| Constraint | Effect | Handling |
|---|---|---|
| **CSP `connect-src`** | WebSocket targets are governed by `connect-src`. If the deployed Playground enumerates allowed origins, *every* user-supplied `wss://` URL is blocked. Cannot be widened from JS. | **Verify deployed headers before building.** Needs `ws:`/`wss:` permitted broadly — a security conversation with whoever owns the site headers. |
| **No custom headers** | `WebSocket(url, protocols)` takes a URL and subprotocols, nothing else. The ws binding's `headers` field is unreachable. So is `http` bearer and `httpApiKey` with `in: header`. | Explicit "this spec requires a header the browser cannot send" state. Offer query-param or subprotocol fallback where the server cooperates. |
| **Mixed content** | An `https` page cannot open `ws://`. Scheme-based, not host-based — `wss://` to any host is fine. `ws://localhost` is exempt (potentially-trustworthy origin). Blocked: `ws://` to any non-loopback host. | Pre-flight (§8.4). Note the localhost exemption is least consistent across browsers — verify in Firefox and Safari, not just Chromium. |

### 8.2 Auth fallbacks and their costs

- **Subprotocol smuggling** — passing a token as a second subprotocol entry. If the server doesn't select one, **the browser closes the connection**. Turns "no auth" into "no connection." Make it opt-in per server, never a default. **Built** as the `auth.subprotocol` option (README): only with it do bearer, header-key and OAuth schemes become enterable, and the field says the server may close the connection.
- **Query param** — lands in server and proxy access logs. Warn in UI. **Built**: the panel collects the key, warns about logs, and keeps the URL that carries it out of the UI, the log and bus events (`ws:status` is redacted). Sites can supply the value instead via `auth.credentials`. Watch URL length ceilings for large tokens.
- **Cookies** — third-party from the Playground's origin, so needs `SameSite=None; Secure` and survives only where third-party cookies aren't blocked. Increasingly rare. **Treat as unsupported** rather than flaky.
- **Origin rejection** — WebSocket has no preflight and is exempt from same-origin policy, but the handshake sends `Origin` and servers may reject it. Users will try to fix this with CORS config and it will do nothing. Say so in the docs.

### 8.3 Connection health

- **No ping/pong access.** Handled inside the browser, not exposed to JS. Two consequences: no protocol-level keepalive (any heartbeat must be application-level, which the spec may not define), and **no half-open detection** — `readyState` stays `OPEN` against a dead peer indefinitely. For a feature whose core promise is a connection-status indicator, this means the indicator can lie. Mitigate with an idle-timeout warning state and optional app-level heartbeat per server.
- **No connect timeout.** Race the constructor against your own `setTimeout` + `close()`, or a wrong hostname hangs in "connecting."
- **Self-signed certs** cannot be accepted programmatically and show **no interstitial** for `wss://`. The user must open `https://host:port` in a tab, accept, and return. Common in local dev — put it in the error copy.
- **No redirect following.** A 3xx on upgrade fails outright.

### 8.4 Error taxonomy

Nothing about the handshake response reaches JS — not the status code, not the headers. 401, 403, 404, 500, TLS failure, origin rejection, mixed content, and server-down all surface identically as an `error` event plus close code `1006` with an empty reason.

This is the core difficulty behind AC *"errors surface gracefully, distinct from a closed-but-healthy state."* Strategy: **pre-flight everything detectable, then stop guessing.**

```ts
const url = new URL(target);
const insecure = url.protocol === 'ws:';
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

if (window.isSecureContext && insecure && !loopback) {
  return fail('mixed-content');   // specific, actionable
}
if (schemeRequiresHeaderAuth) {
  return fail('unsupported-auth'); // specific, actionable
}
// everything else → "could not connect" without inventing a cause
```

States to distinguish: `idle` · `connecting` · `open` · `closing` · `closed-clean` · `closed-unexpected` · `blocked-precheck` · `unsupported-auth`.

### 8.5 Page lifecycle

An open WebSocket makes a page ineligible for bfcache, and Chrome closes the socket on bfcache entry. Backgrounded mobile tabs get sockets killed by the OS.

This means *"cleanly torn down on navigate away"* and *"connection survives tabbing away"* pull in opposite directions. **Manual reconnect is not a stretch goal** — it becomes necessary the first time someone switches tabs on mobile. Wire `visibilitychange` and `pagehide` into the state machine, not just `unmount`.

### 8.6 Other

- `send()` on text frames requires well-formed UTF-8 — lone surrogates from a JSON editor throw.
- `bufferedAmount` is the only backpressure signal and there is no drain event. Academic for click-to-send; poll it if a burst mode is ever added.
- permessage-deflate is negotiated automatically with no JS control — raw frames cannot be inspected uncompressed.
- **Private Network Access:** Chrome has been tightening requests from public sites to private addresses. Orthogonal to mixed content — could affect `wss://192.168.x.x` from the Playground even with a valid scheme. Check current state; "connect to my box on the LAN" is a plausible use case and this would not appear in mixed-content logic.

### 8.7 Embedding in production

The plugin turns a docs page into a live API client. Controls an embedding site can set (README, "Plugin options"):

- `allowedHosts` — enforced in the pre-connect check, so an edited URL can't get around it.
- `allowUrlEditing: false` — panels connect only to URLs resolved from the spec.
- `maxFrameLength` / `maxLogLength` — a hostile or very busy server can't exhaust memory through the log.

Still open: untrusted specs on the Playground (no fixed allowlist is possible there, and a spec can point panels at any `wss://` host or at private addresses), and credential handling once auth exists.

**Validator: `@cfworker/json-schema`, not Ajv.** Measured 2026-09-15 against the Kraken and Gemini dev specs, in Node, with `--disallow-code-generation-from-strings` standing in for a CSP without `unsafe-eval`:

| | `@cfworker/json-schema` 4.1.1 | Ajv 8.20.0 + ajv-formats 3.0.1 |
|---|---|---|
| Code generation disallowed | works | throws `EvalError` on every schema |
| Size, minified + gzip | 5.9 KB | 40.9 KB |
| Gemini update, all errors | ~36 µs | ~0.6 µs, after a ~21 ms compile |
| Findings on real frames | same as Ajv | same as cfworker |

Both flag Kraken's `XBTUSD` (pattern), a string `reqid` and a bad `subscription.name` (enum), and Gemini's string prices and `side: "ask"`. Ajv is ~60× faster per frame, but at ~135 msg/s cfworker costs about 5 ms of CPU per second, so speed doesn't decide it. What does: the plugin shouldn't add a new `unsafe-eval` requirement.

**Caveat: the library likely needs `unsafe-eval` already.** `@asyncapi/parser` 3.6.3 depends on Ajv, and with code generation disallowed, importing it throws `EvalError` in Node before any spec is parsed. Expect `<AsyncApi>` to fail under a CSP without `unsafe-eval` regardless of this plugin; confirm in a browser (Phase 0). That makes the Playground's CSP conversation two questions: `connect-src` for sockets, and `unsafe-eval` for the parser.

**Revisit if the parser keeps Ajv.** The parser already depends on `ajv ^8.18.0` and `ajv-formats ^2.1.1`, so a plugin on the same majors would share that copy: close to zero added size, and no new CSP requirement. If the browser check confirms `<AsyncApi>` needs `unsafe-eval` and there's no plan to remove it, Ajv becomes the free, more mature choice. Only `src/engine/validation.ts` imports the validator, so switching is a one-file change.

---

## 9. Phasing

Draft PR deadline **2026-09-27**; final merge window **2026-10-18 → 2026-11-01**.

### Phase 0 — Unblock (do first, before any plugin code)
- [ ] Verify deployed Playground CSP `connect-src` permits `ws:`/`wss:` — **this can invalidate the whole feature**
- [ ] Confirm in a browser whether `<AsyncApi>` renders under a CSP without `unsafe-eval` (§8.7: its parser uses Ajv)
- [ ] Confirm the `PluginManager` truthiness bug (§2.4) is fixed
- [ ] Confirm what props `PluginSlot.OPERATION` currently passes
- [ ] Spike: `ws://localhost` from an https page in Chrome, Firefox, Safari

### Phase 1 — Core (library changes, §2)
- [ ] `PluginSlot.DOCUMENT`
- [x] Widen slot props to `{ operation, channel, document }` — typed `OperationSlotContext` / `InfoSlotContext`
- [x] `uninstall` / `dispose` on `AsyncApiPlugin`, called on unregister and unmount

### Phase 2 — Engine (no UI)
- [ ] Intent model + direction normalization (§5)
- [ ] URL resolution: server variables + channel ws binding + security
- [ ] `ConnectionManager` with external store + state machine (§8.4)
- [ ] Pre-flight checks
- [ ] Frame routing + discriminator inference (§6)
- [x] Validator cache (`@cfworker/json-schema`, §8.7) — one validator per schema, one result per frame

### Phase 3 — UI  → *satisfies most ACs*
- [ ] `ConnectionBar` in DOCUMENT slot: server picker, auth, connect/disconnect, status
- [ ] `OperationPanel` in OPERATION slot, branching on direction
- [x] Send: editor seeded from `examples()` → schema sampler, validated as you type (never blocks sending)
- [ ] Receive: virtualized live log with per-frame validation badges — badges done; the log isn't virtualized yet (renders the latest 200)
- [ ] Manual reconnect
- [ ] Teardown on unmount + `visibilitychange` / `pagehide`

### Phase 4 — Differentiator
- [x] `correlationId` runtime-expression evaluator — `$message.payload#/…`; `$message.header#/…` is flagged as unmatchable (WebSocket frames have no headers)
- [ ] 3.0 `operation.reply` support — replies on the request's own channel work; `reply.channel` with a different address (needs a second socket) and `reply.address` are not supported
- [x] Inline `pending → matched` reply rendering

### Explicitly out of scope (per #1299)
Auto-reconnect with backoff · history persistence across reloads · non-WS protocols (MQTT, AMQP, Kafka)

---

## 10. Open questions

1. What props does `PluginSlot.OPERATION` pass today? Determines the size of §2.2.
2. Is `PluginSlot` a closed enum or extensible by plugins? Affects whether §2.1 must land in core or can be plugin-side.
3. Does the event bus batch, or is `emit` synchronous? Drives the §7 boundary between coarse events and the ring buffer.
4. Should the WS plugin ship inside `@asyncapi/react-component`, or as a separate package consumed via `plugins={[...]}`? The AC says the Playground *registers a default* WS plugin — bundled by default is a payload-size question worth settling early.
5. Is there an existing Playground mechanism for persisting per-server settings (auth values, discriminator overrides), or does the plugin own that?