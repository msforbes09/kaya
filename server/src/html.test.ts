import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html.js";

describe("escapeHtml", () => {
  it("escapes &, <, >, \", '", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
