---
"@apiuikit/ws-try-it-plugin": patch
---

Make expanded messages easier to read. Schema validation issues now appear in a red callout above the payload instead of as plain text, and JSON payloads render as a collapsible tree (using `@microlink/react-json-view`, as the OpenAPI try-it plugin does) instead of a raw `JSON.stringify` dump. Payloads of 10K characters or more open collapsed to two levels.
