import type { SVGProps } from "react";
const base = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;
export function PlayIcon() {
  return (
    <svg {...base}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}
export function CloseIcon() {
  return (
    <svg {...base}>
      <path d="m6 6 12 12M6 18 18 6" />
    </svg>
  );
}
export function ExpandIcon() {
  return (
    <svg {...base}>
      <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
    </svg>
  );
}
export function MessagesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z" />
    </svg>
  );
}
export function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 19V5m-7 7 7-7 7 7" />
    </svg>
  );
}
export function ReceiveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14m7-7-7 7-7-7" />
    </svg>
  );
}
export function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4m0-4h.01" />
    </svg>
  );
}
