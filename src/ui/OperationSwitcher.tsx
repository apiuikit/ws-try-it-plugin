import { useId, useMemo, useRef, useState } from "react";
import type { AsyncAPIOperationPluginContext } from "apiuikit/plugin";
import type { ConnectionRegistry } from "../engine/registry";
import { resolveRef, toOperationIntent } from "../engine/intent";
import { OperationPanel } from "./OperationPanel";
import { ReceiveIcon, SendIcon } from "./icons";

interface Props extends AsyncAPIOperationPluginContext {
  registry: ConnectionRegistry;
  onClose: () => void;
}

/** Visited panels stay mounted so server selection, drafts and log filters survive switching. */
export function OperationSwitcher({
  document,
  operationId,
  registry,
  onClose,
}: Props) {
  const id = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const entries = useMemo(
    () =>
      Object.entries(document.operations ?? {}).flatMap(([key, operation]) => {
        const intent = toOperationIntent({ document, operationId: key });
        if (!intent) return [];
        const resolved = resolveRef(document, operation) as
          | Record<string, unknown>
          | undefined;
        const description =
          typeof resolved?.title === "string"
            ? resolved.title
            : typeof resolved?.summary === "string"
            ? resolved.summary
            : undefined;
        const channel = resolveRef(document, resolved?.channel) as
          | Record<string, unknown>
          | undefined;
        const label =
          typeof channel?.address === "string" && channel.address
            ? channel.address
            : key;
        return [{ key, label, description, intent }];
      }),
    [document]
  );
  const [selected, setSelected] = useState(operationId);
  const [visited, setVisited] = useState(() => new Set([operationId]));
  const active = entries.some((entry) => entry.key === selected)
    ? selected
    : operationId;
  const select = (key: string) => {
    setSelected(key);
    setVisited((previous) => new Set(previous).add(key));
  };
  if (entries.length === 1)
    return (
      <OperationPanel
        intent={entries[0].intent}
        registry={registry}
        layout="split"
        onClose={onClose}
      />
    );
  return (
    <div className="aws-panel" data-layout="split">
      <div
        className="aws-operation-tabs"
        role="tablist"
        aria-label="WebSocket operations"
      >
        {entries.map((entry, index) => (
          <button
            key={entry.key}
            ref={(node) => {
              if (node) buttons.current.set(entry.key, node);
              else buttons.current.delete(entry.key);
            }}
            type="button"
            role="tab"
            className="aws-operation-tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={active === entry.key}
            tabIndex={active === entry.key ? 0 : -1}
            title={[
              entry.intent.direction === "clientSends" ? "Send" : "Receive",
              entry.key,
              entry.description,
            ]
              .filter(Boolean)
              .join(" · ")}
            onClick={() => select(entry.key)}
            onKeyDown={(event) => {
              let next: number;
              switch (event.key) {
                case "ArrowRight":
                  next = (index + 1) % entries.length;
                  break;
                case "ArrowLeft":
                  next = (index - 1 + entries.length) % entries.length;
                  break;
                case "Home":
                  next = 0;
                  break;
                case "End":
                  next = entries.length - 1;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              select(entries[next].key);
              buttons.current.get(entries[next].key)?.focus();
            }}
          >
            <span
              className="aws-operation-direction"
              data-direction={entry.intent.direction}
            >
              {entry.intent.direction === "clientSends" ? (
                <SendIcon />
              ) : (
                <ReceiveIcon />
              )}
              <span className="aws-sr-only">
                {entry.intent.direction === "clientSends" ? "Send" : "Receive"}
              </span>
            </span>
            <span className="aws-operation-label">{entry.label}</span>
          </button>
        ))}
      </div>
      {entries.map((entry, index) => (
        <div
          key={entry.key}
          className="aws-operation-content"
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          hidden={active !== entry.key}
        >
          {(visited.has(entry.key) || active === entry.key) && (
            <OperationPanel
              intent={entry.intent}
              registry={registry}
              layout="split"
              onClose={onClose}
            />
          )}
        </div>
      ))}
    </div>
  );
}
