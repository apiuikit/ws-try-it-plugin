import { useId, useMemo, useState } from "react";

import { PlayIcon } from "./icons";
import type { ConnectionManager } from "../engine/connection";
import {
  correlationKey,
  correlationValue,
  parseLocation,
  readPointer,
  schemaAt,
  withCorrelationValue,
  type CorrelationLocation,
} from "../engine/correlation";
import type { OperationIntent } from "../engine/intent";
import type { ConnectionRegistry } from "../engine/registry";
import type { MessageShape } from "../engine/routing";
import { exampleText } from "../engine/sample";
import { validatePayload } from "../engine/validation";

interface ComposerProps {
  intent: OperationIntent;
  connection: ConnectionManager;
  registry: ConnectionRegistry;
  isOpen: boolean;
  /** Correlation ids this operation has already sent. */
  sentKeys: ReadonlySet<string>;
}

type Parsed =
  | { ok: true; value: unknown }
  | { ok: false; error: string }
  | undefined;

const draftKey = (operationId: string, messageId: string | undefined) =>
  `${operationId}:${messageId ?? ""}`;

const MAX_ISSUES_SHOWN = 5;

function parseJson(text: string): Parsed {
  if (text.trim() === "") return undefined;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The message's correlation location, if the composer can do anything with it. */
function locationOf(
  message: MessageShape | undefined
): CorrelationLocation | undefined {
  const location = parseLocation(message?.correlationId);
  if (location?.source === "payload" && location.tokens.length === 0)
    return undefined;
  return location;
}

export function Composer({
  intent,
  connection,
  registry,
  isOpen,
  sentKeys,
}: ComposerProps) {
  const inputId = useId();
  const { messages } = intent;
  const [messageId, setMessageId] = useState(messages[0]?.id);
  const message =
    messages.find((candidate) => candidate.id === messageId) ?? messages[0];
  const location = useMemo(() => locationOf(message), [message]);

  /** A generated id that hasn't been sent yet and differs from the current one. */
  const freshValue = (
    target: MessageShape,
    targetLocation: CorrelationLocation,
    currentKey?: string
  ) => {
    const schema = schemaAt(target.payloadSchema, targetLocation.tokens);
    let value: string | number;
    let key: string | undefined;
    do {
      value = correlationValue(schema, registry.nextCorrelationSeed());
      key = correlationKey(value);
    } while (key === currentKey || (key !== undefined && sentKeys.has(key)));
    return value;
  };

  const seed = (
    target: MessageShape | undefined,
    { ignoreDraft = false } = {}
  ) => {
    if (!target) return "";
    const draft = ignoreDraft
      ? undefined
      : registry.getDraft(draftKey(intent.id, target.id));
    if (draft !== undefined) return draft;

    const text = exampleText(target);
    const targetLocation = locationOf(target);
    const parsed = parseJson(text);
    if (targetLocation?.source !== "payload" || !parsed?.ok) return text;
    if (
      correlationKey(readPointer(parsed.value, targetLocation.tokens)) !==
      undefined
    )
      return text;
    // Examples and samples often omit the id (Kraken's reqid is optional); without it, replies
    // can't be matched.
    return (
      withCorrelationValue(
        text,
        targetLocation,
        freshValue(target, targetLocation)
      ) ?? text
    );
  };

  const [text, setText] = useState(() => seed(message));
  const [sendError, setSendError] = useState<string>();
  const parsed = useMemo(() => parseJson(text), [text]);
  // Checked as you type, but never blocks sending: off-spec payloads are part of testing.
  const validation = useMemo(
    () =>
      message && parsed?.ok
        ? validatePayload(
            message.payloadSchema,
            parsed.value,
            message.schemaFormat
          )
        : undefined,
    [message, parsed]
  );

  const update = (value: string) => {
    setText(value);
    registry.setDraft(draftKey(intent.id, message?.id), value);
  };

  const selectMessage = (id: string) => {
    setMessageId(id);
    setText(seed(messages.find((candidate) => candidate.id === id)));
  };

  const field = location?.tokens[location.tokens.length - 1];
  const currentValue =
    location?.source === "payload" && parsed?.ok
      ? readPointer(parsed.value, location.tokens)
      : undefined;
  const currentKey = correlationKey(currentValue);

  const setNewId = () => {
    if (!message || location?.source !== "payload") return;
    const next = withCorrelationValue(
      text,
      location,
      freshValue(message, location, currentKey)
    );
    if (next !== undefined) update(next);
  };

  const send = () => {
    if (!isOpen) return;
    try {
      connection.send(text, intent.id);
      setSendError(undefined);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
      return;
    }
    // Move on to a new id so the next send is a distinct request.
    if (currentKey !== undefined) setNewId();
  };

  return (
    <div className="aws-composer">
      <div className="aws-row">
        <label className="aws-label" htmlFor={inputId}>
          Message body
        </label>
        {messages.length > 1 ? (
          <select
            className="aws-select"
            aria-label="Message type"
            value={message?.id}
            onChange={(event) => selectMessage(event.target.value)}
          >
            {messages.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        ) : (
          <code>{message?.name ?? "raw text"}</code>
        )}
        <span className="aws-spacer" />
        {message && (
          <button
            type="button"
            className="aws-btn aws-btn-link"
            onClick={() => update(seed(message, { ignoreDraft: true }))}
          >
            Reset to example
          </button>
        )}
      </div>

      <textarea
        id={inputId}
        className="aws-textarea"
        spellCheck={false}
        value={text}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
      />

      {parsed?.ok === false && (
        <div className="aws-notice" data-tone="warn">
          Not valid JSON ({parsed.error}). It will be sent as plain text.
        </div>
      )}

      {validation?.status === "invalid" && (
        <div className="aws-notice" data-tone="warn">
          Doesn’t match the spec’s <code>{message?.name}</code> schema. You can
          still send it.
          <ul className="aws-issues">
            {validation.issues.slice(0, MAX_ISSUES_SHOWN).map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                <code>{issue.path}</code> {issue.message}
              </li>
            ))}
            {validation.issueCount > MAX_ISSUES_SHOWN && (
              <li>…and {validation.issueCount - MAX_ISSUES_SHOWN} more</li>
            )}
          </ul>
        </div>
      )}

      {validation?.status === "unsupported" &&
        message?.payloadSchema !== undefined && (
          <div className="aws-notice" data-tone="info">
            {validation.reason}
          </div>
        )}

      {location?.source === "header" && (
        <div className="aws-notice" data-tone="info">
          Replies correlate on <code>{location.expression}</code>. WebSocket
          frames have no headers, so replies can’t be matched to requests.
        </div>
      )}

      {location?.source === "payload" &&
        parsed?.ok &&
        currentKey === undefined && (
          <div className="aws-notice" data-tone="warn">
            No <code>{field}</code> in this message, so replies can’t be matched
            to it.{" "}
            <button
              type="button"
              className="aws-btn aws-btn-link"
              onClick={setNewId}
            >
              Add {field}
            </button>
          </div>
        )}

      {sendError && <div className="aws-notice">{sendError}</div>}

      <div className="aws-send-footer">
        <button
          type="button"
          className="aws-btn aws-btn-send"
          disabled={!isOpen}
          onClick={send}
        >
          <PlayIcon /> Send
        </button>
        <div className="aws-row">
          <span className="aws-hint">
            {isOpen ? "⌘/Ctrl + Enter" : "Connect to send"}
          </span>
          <span className="aws-spacer" />
          {validation?.status === "valid" && (
            <span className="aws-hint aws-ok">✓ Matches the spec</span>
          )}
        </div>
      </div>
    </div>
  );
}
