import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  ConnectionManager,
  ConnectionSnapshot,
  ConnectionStatus,
} from "../engine/connection";
import { type OperationIntent, type ServerTarget } from "../engine/intent";
import type { ConnectionRegistry } from "../engine/registry";
import {
  authorizeUrl,
  credentialKey,
  planAuth,
  type AuthPlan,
  type AuthScheme,
} from "../engine/security";
import type { PrecheckResult } from "../engine/url";
import { BindingEditor } from "./BindingEditor";
import { CloseIcon } from "./icons";
import { Composer } from "./Composer";
import { FrameLog } from "./FrameLog";
import { useFrameAnalysis } from "./useFrameAnalysis";

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  open: "Connected",
  closing: "Closing…",
  "closed-clean": "Disconnected",
  "closed-unexpected": "Connection failed",
  "blocked-precheck": "Blocked",
};

const isActive = (status: ConnectionStatus) =>
  status === "connecting" || status === "open" || status === "closing";

/** Why the URL can't be connected to, phrased for the panel. */
function blockedMessage(
  check: PrecheckResult,
  url: string,
  target: ServerTarget,
  editable: boolean
): string | undefined {
  if (check.ok) return undefined;
  if (check.reason !== "unresolved-variables") return check.message;
  const missing =
    url === target.url && target.unresolved.length > 0
      ? `No default value for ${target.unresolved
          .map((name) => `{${name}}`)
          .join(", ")}.`
      : check.message;
  return `${missing} ${
    editable
      ? "Edit the URL before connecting."
      : "URL editing is turned off on this site."
  }`;
}

export function OperationPanel({
  intent,
  registry,
  layout = "tab",
  onClose,
}: {
  intent: OperationIntent;
  registry: ConnectionRegistry;
  layout?: "tab" | "split";
  onClose?: () => void;
}) {
  const [serverIndex, setServerIndex] = useState(0);
  const target = intent.targets[serverIndex] ?? intent.targets[0];

  // Re-renders on URL edits and credential changes, which may come from another panel.
  useSyncExternalStore(
    registry.subscribe,
    registry.getVersion,
    registry.getVersion
  );
  const url = registry.resolveUrl(target.url);
  const connection = registry.get(url);
  const snapshot = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
    connection.getSnapshot
  );
  const analysis = useFrameAnalysis(intent, snapshot.frames);
  const isOpen = snapshot.status === "open";

  const plan = useMemo(
    () =>
      planAuth(target.security, {
        subprotocol: registry.subprotocolAuthEnabled,
      }),
    [registry, target]
  );

  // Let the site supply credentials for schemes nobody has filled in.
  useEffect(() => {
    registry.ensureCredentials(target.serverId, plan.schemes);
  }, [registry, target, plan]);

  // Both carry credentials: used only to open the socket, never rendered, logged or published.
  const socketUrl = authorizeUrl(url, plan.schemes, (scheme) =>
    registry.getCredential(credentialKey(target.serverId, scheme.id))
  );
  const protocols = registry.subprotocolsFor(
    target.serverId,
    url,
    plan.schemes
  );
  const credentialsChanged =
    isActive(snapshot.status) && !connection.isUsing(socketUrl, protocols);
  // A rejected handshake looks like any other failure, so say what auth might have to do with it.
  const failureHint =
    plan.blockers.length > 0
      ? "This server also needs credentials the browser can’t send, which is the likely cause."
      : plan.schemes.length > 0
      ? "The server may also have rejected the credentials."
      : undefined;

  return (
    <section
      className="aws-panel"
      data-layout={layout}
      data-testid="ws-plugin-operation-panel"
      aria-label={
        intent.direction === "clientSends"
          ? "WebSocket: send"
          : "WebSocket: receive"
      }
    >
      <ConnectionBar
        onClose={onClose}
        intent={intent}
        target={target}
        serverIndex={serverIndex}
        onServerChange={setServerIndex}
        url={url}
        socketUrl={socketUrl}
        protocols={protocols}
        failureHint={failureHint}
        registry={registry}
        connection={connection}
        snapshot={snapshot}
      />

      <div className="aws-workspace">
        <div className="aws-request">
          <ConnectionNotices
            target={target}
            url={url}
            registry={registry}
            snapshot={snapshot}
          />

          <BindingEditor
            key={target.url}
            binding={intent.binding}
            url={url}
            disabled={isActive(snapshot.status) || !registry.allowUrlEditing}
            active={isActive(snapshot.status)}
            onChange={(next) => registry.setUrlOverride(target.url, next)}
          />

          <AuthSection
            target={target}
            plan={plan}
            registry={registry}
            credentialsChanged={credentialsChanged}
          />

          {intent.direction === "clientSends" && (
            <Composer
              intent={intent}
              connection={connection}
              registry={registry}
              isOpen={isOpen}
              sentKeys={analysis.sentKeys}
            />
          )}
        </div>
        <div className="aws-response">
          <FrameLog
            intent={intent}
            connection={connection}
            frames={snapshot.frames}
            analysis={analysis}
            isOpen={isOpen}
          />
        </div>
      </div>
    </section>
  );
}

interface ConnectionBarProps {
  onClose?: () => void;
  intent: OperationIntent;
  target: ServerTarget;
  serverIndex: number;
  onServerChange: (index: number) => void;
  url: string;
  /** `url` plus credentials, passed straight to the socket. */
  socketUrl: string;
  /** Subprotocols carrying a token, when the site configured that. */
  protocols?: string[];
  /** Extra context for a failed handshake, e.g. that credentials may have been rejected. */
  failureHint?: string;
  registry: ConnectionRegistry;
  connection: ConnectionManager;
  snapshot: ConnectionSnapshot;
}

function ConnectionBar({
  onClose,
  intent,
  target,
  serverIndex,
  onServerChange,
  url,
  socketUrl,
  protocols,
  failureHint,
  registry,
  connection,
  snapshot,
}: ConnectionBarProps) {
  const editable = registry.allowUrlEditing;
  const [draftUrl, setDraftUrl] = useState(url);
  useEffect(() => setDraftUrl(url), [url]);

  const active = isActive(snapshot.status);
  // Run the connect-time checks up front, so a blocked URL is explained before anyone clicks.
  const check = useMemo(() => registry.check(url), [registry, url]);

  const commitUrl = () => {
    const next = draftUrl.trim();
    if (next && next !== url) {
      registry.setUrlOverride(target.url, next);
    } else {
      setDraftUrl(url);
    }
  };

  return (
    <header className="aws-header">
      <span className="aws-protocol">WS</span>
      {intent.targets.length > 1 && (
        <select
          className="aws-select"
          aria-label="Server"
          value={serverIndex}
          disabled={active}
          onChange={(event) => onServerChange(Number(event.target.value))}
        >
          {intent.targets.map((candidate, index) => (
            <option key={candidate.serverId} value={index}>
              {candidate.serverId}
            </option>
          ))}
        </select>
      )}
      <input
        className="aws-input"
        aria-label="WebSocket URL"
        spellCheck={false}
        value={draftUrl}
        readOnly={!editable}
        disabled={active}
        title={
          !editable
            ? "Resolved from the spec. URL editing is turned off on this site."
            : active
            ? "Disconnect to change the URL"
            : undefined
        }
        onChange={(event) => setDraftUrl(event.target.value)}
        onBlur={editable ? commitUrl : undefined}
        onKeyDown={(event) => {
          if (editable && event.key === "Enter") {
            commitUrl();
            event.currentTarget.blur();
          }
        }}
      />
      {active ? (
        <button
          type="button"
          className="aws-btn aws-btn-danger"
          disabled={snapshot.status === "closing"}
          onClick={() => connection.disconnect()}
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          className="aws-btn aws-btn-primary"
          disabled={
            !check.ok ||
            (!!intent.binding?.method &&
              intent.binding.method.toUpperCase() !== "GET")
          }
          title={blockedMessage(check, url, target, editable)}
          onClick={() =>
            connection.connect(socketUrl, { failureHint, protocols })
          }
        >
          {snapshot.status === "idle" ? "Connect" : "Reconnect"}
        </button>
      )}
      <span className="aws-status" role="status">
        <span className="aws-dot" data-status={snapshot.status} />
        {STATUS_LABELS[snapshot.status]}
      </span>
      {onClose && (
        <button
          type="button"
          className="aws-btn aws-icon-action"
          onClick={onClose}
          aria-label="Close WebSocket panel"
          title="Close"
        >
          <CloseIcon />
        </button>
      )}
    </header>
  );
}

interface ConnectionNoticesProps {
  target: ServerTarget;
  url: string;
  registry: ConnectionRegistry;
  snapshot: ConnectionSnapshot;
}

function ConnectionNotices({
  target,
  url,
  registry,
  snapshot,
}: ConnectionNoticesProps) {
  const editable = registry.allowUrlEditing;
  const active = isActive(snapshot.status);
  const check = useMemo(() => registry.check(url), [registry, url]);
  const blocked = blockedMessage(check, url, target, editable);
  const tone =
    snapshot.status === "closed-unexpected" ||
    snapshot.status === "blocked-precheck"
      ? undefined
      : "info";

  return (
    <>
      {editable && url !== target.url && !active && (
        <div className="aws-hint">
          Edited from the spec’s <code>{target.url}</code>{" "}
          <button
            type="button"
            className="aws-btn aws-btn-link"
            onClick={() => registry.setUrlOverride(target.url, target.url)}
          >
            Reset
          </button>
        </div>
      )}

      {blocked && !active && (
        <div className="aws-notice" data-tone="warn">
          {blocked}
        </div>
      )}

      {snapshot.detail && snapshot.status !== "open" && !blocked && (
        <div className="aws-notice" data-tone={tone}>
          {snapshot.detail}
        </div>
      )}
    </>
  );
}

interface AuthSectionProps {
  target: ServerTarget;
  plan: AuthPlan;
  registry: ConnectionRegistry;
  credentialsChanged: boolean;
}

/** What the server's security asks for, and what a browser can and can't send (PROJECT.MD §8.1). */
function AuthSection({
  target,
  plan,
  registry,
  credentialsChanged,
}: AuthSectionProps) {
  if (target.security.length === 0) return null;

  const withInput = plan.schemes.filter(
    (scheme) =>
      scheme.support === "supported" || scheme.support === "via-subprotocol"
  );
  const browserManaged = plan.schemes.filter(
    (scheme) => scheme.support === "browser-managed"
  );

  return (
    <div className="aws-auth">
      <h3 className="aws-label">Authorization</h3>
      {withInput.map((scheme) => (
        <CredentialField
          key={scheme.id}
          serverId={target.serverId}
          scheme={scheme}
          optional={plan.optional}
          registry={registry}
        />
      ))}

      {browserManaged.map((scheme) => (
        <div key={scheme.id} className="aws-hint">
          <strong>{scheme.summary}.</strong> {scheme.note}
        </div>
      ))}

      {plan.blockers.length > 0 && (
        <div className="aws-notice" data-tone={plan.optional ? "info" : "warn"}>
          {plan.optional
            ? "This server also accepts connections without credentials. Its other auth options can’t be sent from a browser:"
            : "This server requires auth that a browser can’t send, so connecting will likely fail:"}
          <ul className="aws-issues">
            {plan.blockers.map((scheme) => (
              <li key={scheme.id}>
                <strong>{scheme.summary}.</strong> {scheme.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {credentialsChanged && (
        <div className="aws-notice" data-tone="info">
          Credentials changed since connecting. Reconnect to use them.
        </div>
      )}
    </div>
  );
}

interface CredentialFieldProps {
  serverId: string;
  scheme: AuthScheme;
  optional: boolean;
  registry: ConnectionRegistry;
}

function CredentialField({
  serverId,
  scheme,
  optional,
  registry,
}: CredentialFieldProps) {
  const inputId = useId();
  const [visible, setVisible] = useState(false);
  const key = credentialKey(serverId, scheme.id);
  const value = registry.getCredential(key) ?? "";
  const provided = registry.isProvidedCredential(key);

  return (
    <div className="aws-credential">
      <label className="aws-field-label" htmlFor={inputId}>
        {scheme.summary}
        {optional ? " (optional)" : ""}
      </label>
      <div className="aws-row">
        <input
          id={inputId}
          className="aws-input"
          type={visible ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder={optional ? "Optional" : "Required"}
          value={value}
          onChange={(event) => registry.setCredential(key, event.target.value)}
        />
        <button
          type="button"
          className="aws-btn"
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      <div className="aws-hint">
        {provided
          ? "Provided by this site; edit to use your own. "
          : "Kept in memory for this page only. "}
        {scheme.note}
        {scheme.description ? ` ${scheme.description}` : ""}
      </div>
    </div>
  );
}
