import { describe, expect, test } from "vitest";
import { getWeekStartMonday } from "./date";
import { buildWeeklySummary, splitToBullets } from "./summary";

describe("getWeekStartMonday", () => {
  test("snaps any date to Monday", () => {
    expect(getWeekStartMonday("2026-02-11")).toBe("2026-02-09");
    expect(getWeekStartMonday("2026-02-09")).toBe("2026-02-09");
    expect(getWeekStartMonday("2026-02-15")).toBe("2026-02-09");
  });
});

describe("splitToBullets", () => {
  test("splits multiline text and removes empty rows", () => {
    expect(splitToBullets(" one \n\n two \r\nthree ")).toEqual(["one", "two", "three"]);
  });
});

describe("buildWeeklySummary", () => {
  test("builds markdown with populated sections", () => {
    const output = buildWeeklySummary(
      [
        { date: "2026-02-09", done: "Built UI", blocked: "", next: "Polish styles" },
        { date: "2026-02-10", done: "Hooked IPC\nAdded tests", blocked: "Waiting on review", next: "" },
      ],
      "2026-02-09",
      "markdown",
    );

    expect(output).toContain("# Week of 2026-02-09");
    expect(output).toContain("## Done");
    expect(output).toContain("- 2026-02-10: Added tests");
    expect(output).toContain("## Blocked");
    expect(output).toContain("- 2026-02-10: Waiting on review");
    expect(output).toContain("## Next");
  });

  test("reports empty weeks", () => {
    expect(buildWeeklySummary([], "2026-02-09", "markdown")).toContain("No entries logged this week.");
  });
});
