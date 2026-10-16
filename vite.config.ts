import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromHere = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  build: {
    // Bundled rather than file-per-module: `tsc` emits extensionless relative imports, which
    // bundlers accept but Node's ESM resolver rejects. One file per format sidesteps that.
    lib: {
      entry: fromHere("./src/index.ts"),
      formats: ["es", "cjs"],
      fileName: (format) => (format === "cjs" ? "index.cjs" : "index.js"),
    },
    // Peer and runtime dependencies stay external: consumers install their own copies.
    rollupOptions: {
      external: [
        "react",
        "react/jsx-runtime",
        "react-dom",
        "apiuikit/plugin",
        "@cfworker/json-schema",
        "@microlink/react-json-view",
      ],
    },
    target: "es2022",
    sourcemap: true,
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
