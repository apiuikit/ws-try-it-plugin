import ReactJsonView, { type ThemeObject } from "@microlink/react-json-view";

const color = {
  border: "rgb(var(--color-border, 228 228 231) / 1)",
  textPrimary: "rgb(var(--color-text-primary, 24 24 27) / 1)",
  textSecondary: "rgb(var(--color-text-secondary, 82 82 91) / 1)",
  textMuted: "rgb(var(--color-text-muted, 161 161 170) / 1)",
  primary600: "rgb(var(--color-primary-600, 37 99 235) / 1)",
  primary700: "rgb(var(--color-primary-700, 29 78 216) / 1)",
  success: "#16a34a",
  error: "#dc2626",
  warning: "#d97706",
};

// Same slot mapping as openapi-try-it-plugin's ResponseViewer, so payloads look alike in both
// panels. The library doesn't follow the base16 guide's roles (base07 is the key/brace text),
// so this follows its own theme-building code instead.
const theme: ThemeObject = {
  base00: "transparent", // background; the container supplies it
  base01: color.border,
  base02: color.border, // object border + null pill background
  base03: color.textMuted,
  base04: color.textMuted, // "3 items" label
  base05: color.textMuted, // undefined
  base06: color.textPrimary,
  base07: color.textPrimary, // keys and braces
  base08: color.error, // NaN
  base09: color.success, // strings + ellipsis
  base0A: color.textMuted, // null / regexp
  base0B: color.warning, // floats
  base0C: color.primary700, // array indices
  base0D: color.textSecondary, // expanded icon
  base0E: color.primary600, // collapsed icon + booleans
  base0F: color.warning, // integers + copy icon
};

interface JsonTreeProps {
  src: object;
  /** Depth to expand to, or false to expand everything. */
  collapsed?: number | false;
}

export function JsonTree({ src, collapsed = false }: JsonTreeProps) {
  return (
    <ReactJsonView
      src={src}
      theme={theme}
      style={{ background: "transparent", fontFamily: "inherit" }}
      name={false}
      iconStyle="triangle"
      collapsed={collapsed}
      displayDataTypes={false}
      quotesOnKeys={false}
    />
  );
}
