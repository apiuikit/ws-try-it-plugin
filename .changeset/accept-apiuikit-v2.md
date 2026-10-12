---
"@apiuikit/ws-try-it-plugin": patch
---

Accept apiuikit 2.x as a peer dependency. Previously the `^1.7.0` peer range made npm install a second, nested copy of apiuikit 1.x for the plugin when used with apiuikit 2.x, which crashed the panel with "useDocumentContext must be used within a document provider".
