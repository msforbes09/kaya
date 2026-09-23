import { describe, expect, it } from "vitest";
import { parseMemberArgs } from "./member-args.js";

describe("parseMemberArgs", () => {
  it("targets one member by GitHub login", () => {
    expect(parseMemberArgs(["--login", "msforbes09"], "forget")).toEqual({ ok: true, target: { login: "msforbes09" } });
  });
  it("targets everyone only with an explicit --all", () => {
    expect(parseMemberArgs(["--all"], "forget")).toEqual({ ok: true, target: { all: true } });
  });
  it("refuses to guess", () => {
    expect(parseMemberArgs([], "forget")).toMatchObject({ ok: false });
    expect(parseMemberArgs(["--login"], "forget")).toMatchObject({ ok: false });
    expect(parseMemberArgs(["--login", "a", "--all"], "forget")).toMatchObject({ ok: false });
  });
  it("names the script in its usage line", () => {
    expect(parseMemberArgs([], "signout")).toMatchObject({ ok: false, error: expect.stringContaining("npm run signout") });
  });
});
