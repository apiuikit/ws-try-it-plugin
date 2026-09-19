const STYLE_ID = "apiuikit-ws-try-it-plugin-styles";

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// Plain CSS rather than Tailwind classes: the library's stylesheet only contains the utilities
// the library itself uses.
const CSS = `
.aws-panel { --ws-border: rgb(var(--color-border, 228 228 231) / 1); --ws-surface: rgb(var(--color-surface, 250 250 250) / 1); --ws-bg: rgb(var(--color-background, 255 255 255) / 1); --ws-text: rgb(var(--color-text-primary, 24 24 27) / 1); --ws-secondary: rgb(var(--color-text-secondary, 82 82 91) / 1); --ws-muted: rgb(var(--color-text-muted, 161 161 170) / 1); --ws-primary: rgb(var(--color-primary-600, 37 99 235) / 1); --ws-neutral: rgb(var(--color-neutral-100, 241 245 249) / 1); display: flex; flex-direction: column; gap: 1.25rem; min-width: 0; max-width: 100%; container: ws-panel / inline-size; font-size: .8125rem; line-height: 1.5; color: var(--ws-text); }
.aws-panel[data-layout="split"] { flex: 1; min-height: 0; gap: 0; overflow: hidden; container-type: inline-size; }
.aws-operation-bar { display: flex; flex: 0 0 auto; align-items: center; gap: .5rem; padding: .5rem 1rem 0; background: var(--ws-surface); box-shadow: inset 0 -1px var(--ws-border); }
.aws-operation-bar > .aws-icon-action { margin-bottom: .5rem; }
.aws-operation-tabs { display: flex; flex: 1; min-width: 0; align-self: flex-end; align-items: flex-end; gap: .125rem; overflow-x: auto; overflow-y: hidden; }
.aws-operation-tab { display: inline-flex; flex: 0 0 auto; align-items: center; gap: .5rem; max-width: 22rem; padding: .375rem .75rem; border: 1px solid transparent; border-bottom: 0; border-radius: .375rem .375rem 0 0; background: transparent; color: var(--ws-muted); font: inherit; font-size: .875rem; font-weight: 500; cursor: pointer; transition: color .15s; }
.aws-operation-tab[aria-selected="true"] { background: var(--ws-neutral); color: var(--ws-text); border-color: var(--ws-border); }
.aws-operation-tab:hover { color: var(--ws-secondary); }
.aws-operation-tab[aria-selected="true"]:hover { color: var(--ws-text); }
.aws-operation-tab:focus-visible { outline: 2px solid var(--ws-primary); outline-offset: -2px; }
.aws-operation-direction { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 1.375rem; height: 1.375rem; border-radius: 50%; }
.aws-operation-direction[data-direction="clientSends"] { color: var(--ws-primary); background: color-mix(in srgb, var(--ws-primary) 14%, transparent); }
.aws-operation-direction[data-direction="clientReceives"] { color: #16a34a; background: rgb(22 163 74 / .14); }
.aws-operation-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ${MONO}; }
.aws-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.aws-operation-content { display: flex; flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
.aws-operation-content[hidden] { display: none; }
.aws-header { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; padding: .5rem .625rem; border: 1px solid var(--ws-border); border-radius: .375rem; background: var(--ws-surface); }
.aws-panel[data-layout="split"] .aws-header { flex-shrink: 0; padding: .75rem 1rem; border: 0; border-bottom: 1px solid var(--ws-border); border-radius: 0; background: var(--ws-bg); }
.aws-protocol { flex-shrink: 0; font-size: .6875rem; font-weight: 700; padding: .125rem .4375rem; border-radius: .25rem; background: #DBEAFE; color: #1E40AF; letter-spacing: .02em; }
.aws-status { display: inline-flex; align-items: center; gap: .375rem; font-size: .7rem; color: var(--ws-secondary); white-space: nowrap; }
.aws-dot { width: .375rem; height: .375rem; border-radius: 50%; background: var(--ws-muted); }
.aws-dot[data-status="open"] { background: #16a34a; }
.aws-dot[data-status="connecting"], .aws-dot[data-status="closing"] { background: #d97706; }
.aws-dot[data-status="closed-unexpected"], .aws-dot[data-status="blocked-precheck"] { background: #dc2626; }
.aws-workspace { display: flex; flex-direction: column; gap: 1.25rem; min-height: 0; }
.aws-request { display: flex; flex-direction: column; gap: 1.25rem; min-width: 0; }
.aws-response { min-width: 0; display: flex; flex-direction: column; gap: 1.25rem; }
.aws-panel[data-layout="split"] .aws-workspace { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0; overflow: hidden; }
.aws-panel[data-layout="split"] .aws-request { overflow-y: auto; padding: 1rem; }
.aws-panel[data-layout="split"] .aws-response { display: flex; flex-direction: column; overflow: auto; border-left: 1px solid var(--ws-border); padding: 1rem; }
.aws-row { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
.aws-label { margin: 0; font-size: .75rem; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: var(--ws-secondary); }
.aws-spacer { flex: 1; }
.aws-input, .aws-select, .aws-textarea { box-sizing: border-box; font: inherit; font-size: .8125rem; color: var(--ws-text); background: var(--ws-bg); border: 1px solid var(--ws-border); border-radius: .25rem; padding: .375rem .5rem; min-width: 0; max-width: 100%; }
.aws-input:disabled, .aws-input:read-only { color: var(--ws-muted); background: var(--ws-surface); }
.aws-input { flex: 1; font-family: ${MONO}; }
.aws-header .aws-input { flex: 1 1 12rem; font-size: .75rem; }
.aws-textarea { width: 100%; min-height: 14rem; resize: vertical; font-family: ${MONO}; font-size: .75rem; padding: .625rem; line-height: 1.7; tab-size: 2; }
.aws-input:focus-visible, .aws-select:focus-visible, .aws-textarea:focus-visible, .aws-btn:focus-visible, .aws-frame > summary:focus-visible { outline: 2px solid var(--ws-primary); outline-offset: 2px; }
.aws-btn { display: inline-flex; align-items: center; justify-content: center; gap: .375rem; font: inherit; font-size: .75rem; font-weight: 500; line-height: 1.5; padding: .25rem .625rem; border: 1px solid var(--ws-border); border-radius: .375rem; background: transparent; color: var(--ws-secondary); cursor: pointer; white-space: nowrap; }
.aws-btn:hover:not(:disabled) { background: var(--ws-surface); }
.aws-btn:disabled { opacity: .5; cursor: not-allowed; }
.aws-btn-primary { background: var(--ws-primary); border-color: transparent; color: #fff; padding: .375rem .875rem; font-size: .8125rem; }
.aws-btn-send { width: 100%; background: var(--ws-primary); border-color: transparent; color: #fff; padding: .5rem .875rem; font-size: .8125rem; }
.aws-btn-primary:hover:not(:disabled), .aws-btn-send:hover:not(:disabled) { background: rgb(var(--color-primary-700, 29 78 216) / 1); }
.aws-btn-danger { color: #dc2626; }
.aws-btn-link { color: var(--ws-primary); }
.aws-icon-action { flex: 0 0 auto; width: 1.75rem; height: 1.75rem; padding: 0; border-radius: .25rem; }
.aws-hint { overflow-wrap: anywhere; font-size: .7rem; color: var(--ws-muted); }
.aws-bindings { display: flex; flex-direction: column; gap: .75rem; flex-shrink: 0; }
.aws-binding-field { display: flex; flex-direction: column; gap: .375rem; }
.aws-binding-name { flex: 0 1 40%; min-width: 0; overflow-wrap: anywhere; font-family: ${MONO}; font-size: .75rem; }
.aws-binding-info { display: inline-flex; flex-shrink: 0; color: var(--ws-muted); cursor: help; }
.aws-binding-info:hover { color: var(--ws-secondary); }
.aws-binding-field input[type="checkbox"] { accent-color: var(--ws-primary); flex-shrink: 0; }
.aws-auth, .aws-composer { display: flex; flex-direction: column; gap: .75rem; }
.aws-credential { display: grid; gap: .375rem; }
.aws-field-label { overflow-wrap: anywhere; font-size: .75rem; font-weight: 500; color: var(--ws-secondary); }
.aws-send-footer { position: sticky; bottom: 0; z-index: 1; display: flex; flex-direction: column; gap: .5rem; padding: .75rem 0; border-top: 1px solid var(--ws-border); background: var(--ws-bg); }
.aws-panel[data-layout="split"] .aws-composer { flex: 1; }
.aws-panel[data-layout="split"] .aws-send-footer { margin-top: auto; bottom: -1rem; }
.aws-notice { padding: .5rem .625rem; border: 1px solid #fecaca; border-radius: .25rem; background: var(--ws-surface); color: #dc2626; font-size: .75rem; overflow-wrap: anywhere; }
.aws-notice[data-tone="warn"] { border-color: #d97706; color: var(--ws-secondary); }
.aws-notice[data-tone="info"] { border-color: var(--ws-border); color: var(--ws-secondary); }
.aws-check { display: inline-flex; align-items: center; gap: .375rem; font-size: .75rem; color: var(--ws-secondary); cursor: pointer; }
.aws-check input { accent-color: var(--ws-primary); }
.aws-log-section { display: flex; flex-direction: column; gap: .75rem; min-height: 0; }
.aws-panel[data-layout="split"] .aws-log-section { flex: 1; }
.aws-log { overflow: auto; max-height: 28rem; border: 1px solid var(--ws-border); border-radius: .25rem; background: var(--ws-surface); color: var(--ws-text); font-family: ${MONO}; font-size: .75rem; }
.aws-panel[data-layout="split"] .aws-log { flex: 1; max-height: none; min-height: 12rem; }
.aws-log-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .625rem; min-height: 15rem; height: 100%; box-sizing: border-box; padding: 1.5rem 1rem; text-align: center; color: var(--ws-muted); font-family: inherit; }
.aws-log-empty strong { font-size: .8125rem; font-weight: 500; color: var(--ws-secondary); }
.aws-log-empty span { max-width: 18rem; font-size: .75rem; }
.aws-frame { border-bottom: 1px solid var(--ws-border); }
.aws-frame:last-child { border-bottom: 0; }
.aws-frame > summary { display: flex; align-items: center; gap: .5rem; padding: .625rem; cursor: pointer; list-style: none; overflow: hidden; }
.aws-frame > summary::-webkit-details-marker { display: none; }
.aws-frame > summary:hover { background: var(--ws-bg); }
.aws-frame > pre { margin: 0; padding: .625rem; border-top: 1px solid var(--ws-border); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ws-text); font: inherit; }
.aws-time { color: var(--ws-muted); flex-shrink: 0; }
.aws-arrow { width: 1ch; font-weight: 700; }
.aws-arrow[data-direction="in"] { color: #16a34a; }
.aws-arrow[data-direction="out"] { color: var(--ws-primary); }
.aws-badge { flex-shrink: 0; max-width: 100%; overflow-wrap: anywhere; padding: .125rem .375rem; border-radius: .25rem; background: #DBEAFE; color: #1E40AF; font-size: .6875rem; }
.aws-badge[data-kind="unmatched"], .aws-badge[data-kind="pending"] { background: #FEF3C7; color: #92400E; }
.aws-badge[data-kind="error"] { background: #FEE2E2; color: #991B1B; }
.aws-badge[data-kind="muted"] { background: var(--ws-bg); color: var(--ws-secondary); }
.aws-badge[data-kind="matched"] { background: #DCFCE7; color: #166534; }
.aws-badge[data-kind="valid"] { padding: 0; background: transparent; color: #16a34a; }
.aws-issues { margin: .25rem 0 0; padding-left: 1.1rem; }
.aws-issues li { margin: .1rem 0; }
.aws-ok { color: #16a34a; }
.aws-preview { flex: 1; min-width: 3rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/**
 * Panels render inside the library's `.aui-root`, whose scoped Tailwind reset targets
 * `.aui-root button` and `.aui-root input` (specificity 0,1,1: transparent background, no
 * padding). A single class (0,1,0) loses to that regardless of stylesheet order, so every rule
 * is prefixed with `.aws-panel`, giving at least 0,2,0.
 */
function scopeRule(rule: string): string {
  const open = rule.indexOf("{");
  if (open === -1) return rule;
  const selectors = rule
    .slice(0, open)
    .split(",")
    .map((selector) => selector.trim())
    .map((selector) =>
      selector.startsWith(".aws-panel") ? selector : `.aws-panel ${selector}`
    );
  return `${selectors.join(", ")} ${rule.slice(open)}`;
}

export const PLUGIN_CSS = CSS.trim().split("\n").map(scopeRule).join("\n");

export function injectStyles(): void {
  if (typeof document === "undefined") {
    return;
  }
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  // Replace rather than skip, so a reinstall (or a dev hot reload) never keeps stale rules.
  style.textContent = PLUGIN_CSS + RESPONSIVE_CSS;
}

/** Modal rules are scoped separately because the overlay is outside the panel. */
export const RESPONSIVE_CSS = `
.aws-modal-overlay { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; box-sizing: border-box; height: 100vh; height: 100dvh; padding: clamp(.75rem, 3vw, 2rem); background: #0008; }
.aws-modal-overlay > .aws-modal { box-sizing: border-box; display: flex; width: 100%; max-width: 90rem; height: 100%; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid rgb(var(--color-border, 228 228 231) / 1); border-radius: .5rem; background: rgb(var(--color-background, 255 255 255) / 1); }
@media (max-width: 600px), (max-height: 480px) {
  .aws-modal-overlay { padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
  .aws-modal-overlay > .aws-modal { border-radius: 0; }
}
@container ws-panel (max-width: 760px) {
  .aws-panel[data-layout="split"] .aws-workspace { display: flex; overflow-y: auto; overscroll-behavior: contain; }
  .aws-panel[data-layout="split"] .aws-request { flex: 0 0 auto; overflow: visible; padding: .75rem; }
  .aws-panel[data-layout="split"] .aws-response { flex: 0 0 auto; overflow: visible; border-left: 0; border-top: 1px solid var(--ws-border); padding: .75rem; }
  .aws-panel[data-layout="split"] .aws-composer { flex: none; }
  .aws-panel[data-layout="split"] .aws-log { max-height: 24rem; flex: auto; }
  .aws-panel[data-layout="split"] .aws-send-footer { bottom: -.75rem; }
  .aws-panel .aws-frame > summary { flex-wrap: wrap; }
  .aws-panel .aws-preview { flex-basis: 100%; min-width: 0; }
}
@container ws-panel (max-width: 480px) {
  .aws-panel .aws-operation-bar { padding: .375rem .5rem 0; gap: .25rem; }
  .aws-panel .aws-operation-tab { min-height: 44px; max-width: 15rem; font-size: .75rem; padding: .5rem; }
  .aws-panel .aws-operation-tabs { scroll-padding-inline: .5rem; }
  .aws-panel .aws-header { padding: .625rem; }
  .aws-panel .aws-header .aws-input { order: 2; flex: 1 0 100%; width: 100%; }
  .aws-panel .aws-header > .aws-select { flex: 1 1 8rem; max-width: calc(100% - 6rem); }
  .aws-panel .aws-header > .aws-btn-primary, .aws-panel .aws-header > .aws-btn-danger { order: 3; flex: 1 1 auto; }
  .aws-panel .aws-header .aws-status { order: 4; }
  .aws-panel .aws-header > .aws-icon-action { margin-left: auto; }
  .aws-panel .aws-btn { min-height: 44px; }
  .aws-panel .aws-icon-action { width: 44px; height: 44px; }
  .aws-panel .aws-input, .aws-panel .aws-select, .aws-panel .aws-textarea { font-size: 1rem; }
  .aws-panel .aws-input, .aws-panel .aws-select { min-height: 44px; }
  .aws-panel .aws-binding-field > .aws-row { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr) auto; align-items: center; }
  .aws-panel .aws-binding-name { grid-column: 2; }
  .aws-panel .aws-binding-field .aws-input { grid-column: 2 / -1; width: 100%; }
  .aws-panel .aws-binding-add { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
  .aws-panel .aws-binding-add > .aws-input { width: 100%; grid-column: 1; }
  .aws-panel .aws-binding-add > .aws-btn { grid-column: 2; grid-row: 1 / 3; }
  .aws-panel .aws-textarea { min-height: 10rem; }
  .aws-panel .aws-log-empty { min-height: 10rem; }
  .aws-panel .aws-frame > summary { gap: .375rem; padding: .5rem; }
  .aws-panel .aws-check { min-height: 44px; }
}
`;
