import { describe, expect, it } from "vitest";

import { formatDate, formatSize } from "../format";

describe("formatDate", () => {
  it("formats an ISO string as a short ru-RU date and time", () => {
    const value = "2024-05-15T12:30:00";

    expect(formatDate(value)).toBe("15.05.2024, 12:30");
  });
});

describe("formatSize", () => {
  it("formats bytes, kilobytes and megabytes with the right unit", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(5.5 * 1024 * 1024)).toBe("5.5 MB");
  });
});
