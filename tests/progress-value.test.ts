import { describe, expect, it } from "vitest";
import { progressValue } from "../src/utils";

describe("reading progress property", () => {
  it("stores numeric pages as numbers and other page labels as text", () => {
    expect(progressValue("14")).toBe(14);
    expect(progressValue(" 203 ")).toBe(203);
    expect(progressValue("xii")).toBe("xii");
    expect(progressValue("12a")).toBe("12a");
  });
});
