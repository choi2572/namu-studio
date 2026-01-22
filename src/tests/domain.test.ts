import { describe, expect, it } from "vitest";

import { formatDuration } from "@/lib/format";
import { isRunActive, isRunTerminal, RunStatus } from "@/domain/types";

describe("domain utils", () => {
  it("formats duration in minutes and seconds", () => {
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(null)).toBe("-");
  });

  it("detects terminal run statuses", () => {
    expect(isRunTerminal(RunStatus.SUCCESS)).toBe(true);
    expect(isRunTerminal(RunStatus.FAILED)).toBe(true);
    expect(isRunTerminal(RunStatus.CANCELED)).toBe(true);
    expect(isRunTerminal(RunStatus.RUNNING)).toBe(false);
  });

  it("detects active run statuses", () => {
    expect(isRunActive(RunStatus.RUNNING)).toBe(true);
    expect(isRunActive(RunStatus.WAITING)).toBe(true);
    expect(isRunActive(RunStatus.CREATED)).toBe(false);
  });
});
