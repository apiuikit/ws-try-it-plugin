import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ConnectionManager, Frame } from "../engine/connection";
import type { CorrelationResult } from "../engine/correlation";
import type { OperationIntent } from "../engine/intent";
import { hasSecrets, maskSecrets } from "../engine/security";
import { MessagesIcon } from "./icons";
import { JsonTree } from "./JsonTree";
import type { FrameAnalysis } from "./useFrameAnalysis";

// Until the log is virtualized (PROJECT.MD §7), cap what is rendered.
const MAX_RENDERED = 200;
// Collapsed rows only need a glimpse; an order book snapshot can be hundreds of KB.
const PREVIEW_CHARS = 300;
const LARGE_FRAME_CHARS = 10_000;

interface FrameLogProps {
  intent: OperationIntent;
  connection: ConnectionManager;
  frames: readonly Frame[];
  analysis: FrameAnalysis;
  isOpen: boolean;
}

interface Badge {
  kind: string;
  label: string;
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

const formatTime = (at: number) => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}.${pad(date.getMilliseconds(), 3)}`;
};

const formatSize = (chars: number) => {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)} MB`;
  if (chars >= 1_000) return `${Math.round(chars / 1000)} KB`;
  return `${chars} chars`;
};

interface FrameDisplay {
  /** Collapsed-row text, with any secrets hidden. */
  preview: string;
  masked: boolean;
}

// Scanning and masking happen once per frame, not on every render.
const displays = new WeakMap<Frame, FrameDisplay>();

function displayFor(frame: Frame): FrameDisplay {
  let display = displays.get(frame);
  if (!display) {
    display =
      frame.isJson && hasSecrets(frame.json)
        ? { preview: JSON.stringify(maskSecrets(frame.json)), masked: true }
        : { preview: frame.text, masked: false };
    displays.set(frame, display);
  }
  return display;
}

function correlationBadge(
  frameId: number,
  correlation: CorrelationResult | undefined,
  isOpen: boolean
): Badge | undefined {
  const request = correlation?.requests.get(frameId);
  if (request) {
    if (request.key === undefined) {
      return { kind: "unmatched", label: `no ${request.field}` };
    }
    const id = `${request.field} ${String(request.value)}`;
    const count = request.replyFrameIds.length;
    if (count === 0) {
      return isOpen
        ? { kind: "pending", label: `${id} · waiting` }
        : { kind: "unmatched", label: `${id} · no reply` };
    }
    return {
      kind: "matched",
      label: `${id} · ${count > 1 ? `${count} replies · ` : ""}${
        request.latencyMs
      } ms`,
    };
  }

  const reply = correlation?.replies.get(frameId);
  if (reply) {
    return {
      kind: "matched",
      label: `↳ ${reply.field} ${String(reply.value)} · ${reply.latencyMs} ms`,
    };
  }
  return undefined;
}

export function FrameLog({
  intent,
  connection,
  frames,
  analysis,
  isOpen,
}: FrameLogProps) {
  const [showAll, setShowAll] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const { messageIds, validations, correlation } = analysis;

  const names = useMemo(
    () =>
      new Map(
        intent.routingMessages.map((message) => [message.id, message.name])
      ),
    [intent]
  );

  // Inbound frames this operation cares about: replies for a send, its own messages for a receive.
  const relevantIds = useMemo(
    () =>
      new Set(
        (intent.direction === "clientSends"
          ? intent.replyMessages
          : intent.messages
        ).map((message) => message.id)
      ),
    [intent]
  );

  const isRelevant = (frame: Frame) => {
    if (frame.direction === "out") return frame.source === intent.id;
    if (correlation?.replies.has(frame.id)) return true;
    // Without a discriminator frames can't be told apart, so a receive panel shows all of them.
    if (!intent.discriminator) return intent.direction === "clientReceives";
    const messageId = messageIds.get(frame.id);
    // A reply carrying an id that none of our requests used belongs to someone else's request.
    return (
      messageId !== undefined &&
      relevantIds.has(messageId) &&
      !correlation?.keyedInbound.has(frame.id)
    );
  };

  const visible = showAll ? frames : frames.filter(isRelevant);
  const rendered = visible.slice(-MAX_RENDERED);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && stickToBottom.current) {
      log.scrollTop = log.scrollHeight;
    }
  }, [rendered.length, rendered[rendered.length - 1]?.id]);

  const hidden = frames.length - visible.length;

  return (
    <section className="aws-log-section" aria-label="Messages">
      <div className="aws-row">
        <h3 className="aws-label">Messages</h3>
        <span className="aws-hint">
          {visible.length} frame{visible.length === 1 ? "" : "s"}
          {!showAll && hidden > 0 && ` · ${hidden} other on this connection`}
          {visible.length > MAX_RENDERED && ` · showing latest ${MAX_RENDERED}`}
        </span>
        <span className="aws-spacer" />
        <label className="aws-check">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
          />
          All traffic
        </label>
        <button
          type="button"
          className="aws-btn aws-btn-link"
          disabled={frames.length === 0}
          onClick={() => connection.clearLog()}
        >
          Clear
        </button>
      </div>

      <div
        ref={logRef}
        className="aws-log"
        onScroll={(event) => {
          const log = event.currentTarget;
          stickToBottom.current =
            log.scrollHeight - log.scrollTop - log.clientHeight < 24;
        }}
      >
        {rendered.length === 0 ? (
          <div className="aws-log-empty">
            <MessagesIcon width={32} height={32} strokeWidth={1.5} />
            <strong>No messages yet</strong>
            <span>
              {intent.direction === "clientSends"
                ? "Sent messages and their replies will appear here."
                : "Incoming messages will appear here once connected."}
            </span>
          </div>
        ) : (
          rendered.map((frame) => {
            const messageId = messageIds.get(frame.id);
            const link = correlationBadge(frame.id, correlation, isOpen);
            const validation = validations.get(frame.id);
            const display = displayFor(frame);
            return (
              <FrameRow
                key={frame.id}
                frame={frame}
                previewText={display.preview}
                masked={display.masked}
                messageName={
                  messageId === undefined
                    ? undefined
                    : names.get(messageId) ?? messageId
                }
                markUnmatched={intent.discriminator !== undefined}
                correlationLabel={link?.label}
                correlationKind={link?.kind}
                valid={validation?.status === "valid"}
                validationIssues={
                  validation?.status === "invalid"
                    ? validation.issues
                        .map((issue) => `${issue.path}: ${issue.message}`)
                        .join("\n")
                    : undefined
                }
                validationIssueCount={
                  validation?.status === "invalid" ? validation.issueCount : 0
                }
                validationPartial={
                  validation?.status === "invalid" &&
                  validation.partial === true
                }
              />
            );
          })
        )}
      </div>
    </section>
  );
}

interface FrameRowProps {
  frame: Frame;
  /** Collapsed-row text; not `frame.text` when secrets are hidden. */
  previewText: string;
  /** Secret-looking values are hidden in this frame. */
  masked: boolean;
  messageName?: string;
  markUnmatched: boolean;
  correlationLabel?: string;
  correlationKind?: string;
  /** Whether the payload matches its message schema. */
  valid?: boolean;
  /** Schema problems, one per line; a string so the memoized row can compare it cheaply. */
  validationIssues?: string;
  /** Total problems found, which can exceed the lines in `validationIssues`. */
  validationIssueCount: number;
  /** Validation stopped at the first problem because the payload is large. */
  validationPartial: boolean;
}

// Frames are immutable and keep their identity across snapshots, and every other prop is a
// primitive, so memoized rows re-render only when their own labels change.
const FrameRow = memo(function FrameRow({
  frame,
  previewText,
  masked,
  messageName,
  markUnmatched,
  correlationLabel,
  correlationKind,
  valid,
  validationIssues,
  validationIssueCount,
  validationPartial,
}: FrameRowProps) {
  const [open, setOpen] = useState(false);
  const shownIssues = validationIssues ? validationIssues.split("\n") : [];
  const hiddenIssues = validationIssueCount - shownIssues.length;

  let badge: Badge | undefined;
  if (frame.error) {
    badge = { kind: "error", label: "send failed" };
  } else if (messageName) {
    badge = { kind: "message", label: messageName };
  } else if (frame.binary) {
    badge = { kind: "muted", label: "binary" };
  } else if (frame.direction === "in" && markUnmatched && !frame.truncated) {
    // Truncated frames were never parsed, so "unmatched" would be misleading.
    badge = { kind: "unmatched", label: "unmatched" };
  }

  const large = frame.size >= LARGE_FRAME_CHARS;

  return (
    <details
      className="aws-frame"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="aws-time">{formatTime(frame.at)}</span>
        <span
          className="aws-arrow"
          data-direction={frame.direction}
          title={frame.direction === "in" ? "Received" : "Sent"}
        >
          {frame.direction === "in" ? "↓" : "↑"}
        </span>
        {badge && (
          <span className="aws-badge" data-kind={badge.kind}>
            {badge.label}
          </span>
        )}
        {valid && (
          <span
            className="aws-badge"
            data-kind="valid"
            title="Matches the spec’s schema"
          >
            ✓
          </span>
        )}
        {validationIssues && (
          <span
            className="aws-badge"
            data-kind="error"
            title={validationIssues}
          >
            {validationPartial
              ? "✗ invalid"
              : `✗ ${validationIssueCount} issue${
                  validationIssueCount === 1 ? "" : "s"
                }`}
          </span>
        )}
        {correlationLabel && (
          <span className="aws-badge" data-kind={correlationKind}>
            {correlationLabel}
          </span>
        )}
        {frame.truncated ? (
          <span
            className="aws-badge"
            data-kind="unmatched"
            title={`Only the first ${frame.text.length.toLocaleString()} characters are kept in the log`}
          >
            truncated · {formatSize(frame.size)}
          </span>
        ) : (
          large && (
            <span className="aws-badge" data-kind="muted">
              {formatSize(frame.size)}
            </span>
          )
        )}
        <span className="aws-preview">
          {previewText.length > PREVIEW_CHARS
            ? `${previewText.slice(0, PREVIEW_CHARS)}…`
            : previewText}
        </span>
      </summary>
      {/* Pretty-printing is deferred until the row is opened. */}
      {open && (
        <FrameBody
          frame={frame}
          masked={masked}
          large={large}
          issues={shownIssues}
          hiddenIssues={validationPartial ? 0 : hiddenIssues}
          partial={validationPartial}
        />
      )}
    </details>
  );
});

interface FrameBodyProps {
  frame: Frame;
  masked: boolean;
  large: boolean;
  issues: readonly string[];
  hiddenIssues: number;
  partial: boolean;
}

function FrameBody({
  frame,
  masked,
  large,
  issues,
  hiddenIssues,
  partial,
}: FrameBodyProps) {
  const json = frame.isJson
    ? masked
      ? maskSecrets(frame.json)
      : frame.json
    : undefined;

  return (
    <div className="aws-frame-body">
      {frame.error && (
        <div className="aws-frame-issues" role="alert">
          {frame.error}
        </div>
      )}
      {issues.length > 0 && (
        <div className="aws-frame-issues" role="alert">
          <strong>
            {partial
              ? "Doesn’t match the spec (large payload, checked up to the first problem)"
              : "Doesn’t match the spec"}
          </strong>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
          {hiddenIssues > 0 && <span>…and {hiddenIssues} more</span>}
        </div>
      )}
      {masked && (
        <span className="aws-frame-note">
          Values that look like secrets are hidden here; the message was sent as
          you wrote it.
        </span>
      )}
      {/* The tree only takes objects and arrays; bare JSON scalars stay as text. */}
      {typeof json === "object" && json !== null ? (
        <div className="aws-frame-json">
          {/* Expanding every node of a large snapshot is slow, so start those collapsed. */}
          <JsonTree src={json} collapsed={large ? 2 : false} />
        </div>
      ) : (
        <pre>{frame.isJson ? JSON.stringify(json) : frame.text}</pre>
      )}
      {frame.truncated && (
        <span className="aws-frame-note">
          … truncated: {formatSize(frame.size)} in total
        </span>
      )}
    </div>
  );
}
