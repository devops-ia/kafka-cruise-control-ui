import { formatBytes, formatMB, formatPct, formatRate } from "./format";

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
