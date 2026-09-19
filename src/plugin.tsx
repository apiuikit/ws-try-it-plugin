import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  definePlugin,
  useDocumentContext,
  type AsyncAPIOperationPluginContext,
} from "apiuikit/plugin";
import { ViewerSessions } from "./engine/sessions";
import { toOperationIntent } from "./engine/intent";
import { OperationSwitcher } from "./ui/OperationSwitcher";
import { OperationPanel } from "./ui/OperationPanel";
import { injectStyles } from "./ui/styles";
import { PlayIcon, ExpandIcon } from "./ui/icons";
import { useEscapeLayer } from "./ui/escapeLayer";
import type { WsPluginOptions } from "./types";

export const PLUGIN_NAME = "@apiuikit/ws-try-it-plugin";

/** Where the panel lives: inline as an operation tab, or behind a trigger that
 * opens it in a modal — a full-width row in the Reference panel body, or a
 * compact button in the operation side panel's header. */
type PanelVariant = "tab" | "row" | "header";

// Themed like the OpenAPI plugin's header trigger, so the two built-ins match.
const headerButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.375rem",
  flexShrink: 0,
  whiteSpace: "nowrap",
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.25rem 0.625rem",
  marginLeft: "10px",
  borderRadius: "0.375rem",
  border: "1px solid rgb(var(--color-border, 228 228 231) / 1)",
  background: "rgb(var(--color-neutral-50, 248 250 252) / 1)",
  color: "rgb(var(--color-primary-600, 37 99 235) / 1)",
  cursor: "pointer",
};

function createPanel(options: WsPluginOptions, variant: PanelVariant) {
  const modal = variant !== "tab";
  const sessions = new ViewerSessions(options);
  return function WsPanel(context: AsyncAPIOperationPluginContext) {
    const { portalHost, rootElement, config } = useDocumentContext();
    const triggerTheme = {
      ...(config?.theme?.colors?.primary?.[600]
        ? { color: config.theme.colors.primary[600] }
        : {}),
      ...(config?.theme?.colors?.neutral?.[50]
        ? { background: config.theme.colors.neutral[50] }
        : {}),
      ...((config?.theme?.light ?? config?.theme?.dark)?.border
        ? { borderColor: (config?.theme?.light ?? config?.theme?.dark)?.border }
        : {}),
    };
    const intent = useMemo(
      () => toOperationIntent(context),
      [context.document, context.operationId]
    );
    const [open, setOpen] = useState(false);
    const dialog = useRef<HTMLDivElement>(null);
    const session = useMemo(
      () => sessions.get(context.document, rootElement ?? null),
      [context.document, rootElement]
    );
    useEffect(() => {
      injectStyles();
      return sessions.retain(session);
    }, [session]);
    useEscapeLayer(open, () => setOpen(false));
    useEffect(() => {
      if (!open) return;
      const previous = window.document.activeElement as HTMLElement | null;
      dialog.current?.focus();
      return () => previous?.focus();
    }, [open]);
    if (!intent)
      return modal ? null : (
        <p role="status">This operation has no supported WebSocket server.</p>
      );
    const panel = (
      <OperationPanel
        key={context.operationId}
        intent={intent}
        layout={modal ? "split" : "tab"}
        onClose={modal ? () => setOpen(false) : undefined}
        registry={session.registry}
      />
    );
    if (!modal) return panel;
    return (
      <>
        {variant === "header" ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{ ...headerButtonStyle, ...triggerTheme }}
          >
            <PlayIcon />
            Try It Out
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              ...headerButtonStyle,
              ...triggerTheme,
              marginLeft: 0,
              width: "100%",
              boxSizing: "border-box",
              justifyContent: "space-between",
              padding: ".75rem 1rem",
              borderRadius: ".5rem",
              fontSize: ".8125rem",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: ".5rem",
              }}
            >
              <PlayIcon />
              Try It Out
            </span>
            <ExpandIcon />
          </button>
        )}
        {open &&
          portalHost &&
          createPortal(
            <div className="aws-modal-overlay" onClick={() => setOpen(false)}>
              <div
                ref={dialog}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label="Try WebSocket"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key !== "Tab") return;
                  const items = Array.from(
                    dialog.current?.querySelectorAll<HTMLElement>(
                      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'
                    ) ?? []
                  ).filter(
                    (element) =>
                      element.tabIndex >= 0 && !element.closest("[hidden]")
                  );
                  if (!items?.length) {
                    e.preventDefault();
                    return;
                  }
                  const first = items[0],
                    last = items[items.length - 1];
                  if (
                    e.shiftKey &&
                    (window.document.activeElement === first ||
                      window.document.activeElement === dialog.current)
                  ) {
                    e.preventDefault();
                    last.focus();
                  } else if (
                    !e.shiftKey &&
                    window.document.activeElement === last
                  ) {
                    e.preventDefault();
                    first.focus();
                  }
                }}
                className="aws-modal"
              >
                <OperationSwitcher
                  key={context.operationId}
                  document={context.document}
                  operationId={context.operationId}
                  registry={session.registry}
                  onClose={() => setOpen(false)}
                />
              </div>
            </div>,
            portalHost
          )}
      </>
    );
  };
}

export function createWsPlugin(options: WsPluginOptions = {}) {
  return definePlugin({
    name: `${PLUGIN_NAME}/tab`,
    slots: {
      "asyncapi.operation.tab": {
        label: "Try it",
        component: createPanel(options, "tab"),
      },
    },
  });
}
export function createWsButtonPlugin(options: WsPluginOptions = {}) {
  return definePlugin({
    name: `${PLUGIN_NAME}/reference-button`,
    slots: {
      "asyncapi.operation.reference.supplementary": createPanel(options, "row"),
    },
  });
}

/** A compact trigger for the operation side panel's header, next to the close
 * button. Not a plugin: the header isn't a public slot, so apiuikit renders
 * this itself when `show.tryIt` is on. Stays visible whichever tab is
 * selected, unlike the Reference-panel row above. */
export function createWsHeaderButton(options: WsPluginOptions = {}) {
  return createPanel(options, "header");
}
