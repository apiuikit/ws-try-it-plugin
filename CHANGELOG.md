# @apiuikit/ws-try-it-plugin

## 0.1.2

### Patch Changes

- 5a823f2: Make expanded messages easier to read. Schema validation issues now appear in a red callout above the payload instead of as plain text, and JSON payloads render as a collapsible tree (using `@microlink/react-json-view`, as the OpenAPI try-it plugin does) instead of a raw `JSON.stringify` dump. Payloads of 10K characters or more open collapsed to two levels.

## 0.1.1

### Patch Changes

- ac4e303: Accept apiuikit 2.x as a peer dependency. Previously the `^1.7.0` peer range made npm install a second, nested copy of apiuikit 1.x for the plugin when used with apiuikit 2.x, which crashed the panel with "useDocumentContext must be used within a document provider".
