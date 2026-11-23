import { formatBytes, formatMB, formatPct, formatRate, formatTime } from "./format";

describe("units", () => {
  it("shows bytes with binary units", () => {
    expect(formatBytes(1073741824)).toBe("1 GiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1099511627776)).toBe("1 TiB");
  });
  it("converts CC's MB and KB/s", () => {
    expect(formatMB(1024)).toBe("1 GiB");
    expect(formatRate(1024)).toBe("1 MiB/s");
  });
  it("formats percentages", () => {
    expect(formatPct(12.345)).toBe("12.3%");
    expect(formatPct(NaN)).toBe("-");
  });
});

describe("formatTime", () => {
  const want = new Date(1760000000000).toLocaleString();
  it("accepts a number or a numeric string", () => {
    expect(formatTime(1760000000000)).toBe(want);
    expect(formatTime("1760000000000")).toBe(want);
  });
  it("shows - for missing or invalid values", () => {
    expect(formatTime(undefined)).toBe("-");
    expect(formatTime("abc")).toBe("-");
  });
});
