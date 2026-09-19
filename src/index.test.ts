import { describe, expect, it } from "vitest";
import { createWsPlugin, createWsButtonPlugin } from "./index";

describe("APIUIKIT plugin contract", () => {
  it("registers the operation tab independently from the supplementary button", () => {
    const tab = createWsPlugin();
    expect(Object.keys(tab.slots)).toEqual(["asyncapi.operation.tab"]);
    expect(tab.slots["asyncapi.operation.tab"]?.label).toBe("Try it");
    expect(Object.keys(createWsButtonPlugin().slots)).toEqual([
      "asyncapi.operation.reference.supplementary",
    ]);
  });
});
