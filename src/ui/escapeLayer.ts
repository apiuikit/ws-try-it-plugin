import { useEffect, useMemo, useRef } from "react";

/** Every dismissible overlay this plugin has open, oldest first. Module scope
 * rather than context: the stack has to span the plugin's own portals, and
 * two operations can never have overlays open at once (only one side panel
 * is open at a time). */
const layers: symbol[] = [];

/**
 * Makes Escape dismiss exactly one overlay: the most recently opened one.
 *
 * Two problems this solves, both previously handled ad hoc:
 *
 * 1. **apiuikit's side panel also closes on Escape.** It listens on
 *    `document` in the *bubble* phase, so a capture-phase listener here runs
 *    first and `stopImmediatePropagation()` keeps the event from ever
 *    reaching it. Without that, dismissing a modal also collapses the whole
 *    operation panel behind it.
 * 2. **Overlays nest** (try-it modal > export menu > response JSON modal).
 *    Every open layer has a listener attached, so whoever swallows the event
 *    first wins — and capture listeners on the same node fire in
 *    registration order, i.e. outermost first, which is backwards. Checking
 *    the stack instead makes the decision independent of listener order: a
 *    layer acts only while it is on top.
 *
 * Stack position follows *open* order, which is what a user perceives as
 * "topmost". Layers that become active in the same commit would push
 * child-before-parent (React runs child effects first), but overlays here
 * always open from separate user actions, one commit apart.
 */
export function useEscapeLayer(active: boolean, onEscape: () => void): void {
  const id = useMemo(() => Symbol("escape-layer"), []);
  // Kept in a ref so a caller passing a fresh closure each render doesn't
  // re-run the effect below — that would pop and re-push the layer, silently
  // promoting it above overlays opened after it.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    layers.push(id);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (layers[layers.length - 1] !== id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onEscapeRef.current();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const index = layers.indexOf(id);
      if (index !== -1) layers.splice(index, 1);
    };
  }, [active, id]);
}
