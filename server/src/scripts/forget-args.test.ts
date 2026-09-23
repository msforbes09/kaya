import { describe, expect, it } from "vitest";
import { parseForgetArgs } from "./forget-args.js";

describe("parseForgetArgs", () => {
  it("targets one member by GitHub login", () => {
    expect(parseForgetArgs(["--login", "msforbes09"])).toEqual({ ok: true, target: { login: "msforbes09" } });
  });
  it("targets everyone only with an explicit --all", () => {
    expect(parseForgetArgs(["--all"])).toEqual({ ok: true, target: { all: true } });
  });
  it("refuses to guess", () => {
    expect(parseForgetArgs([])).toMatchObject({ ok: false });
    expect(parseForgetArgs(["--login"])).toMatchObject({ ok: false });
    expect(parseForgetArgs(["--login", "a", "--all"])).toMatchObject({ ok: false });
  });
});
