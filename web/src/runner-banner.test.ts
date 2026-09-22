import { describe, expect, it } from "vitest";
import { runnerBannerText } from "./runner-banner";

describe("runnerBannerText", () => {
  it("is null when a runner is online", () => {
    expect(runnerBannerText({ online: true, name: "mac" })).toBeNull();
  });
  it("tells the member how to start a runner when offline", () => {
    expect(runnerBannerText({ online: false })).toBe("No runner connected. Run npx kaya-runner on your machine.");
  });
});
