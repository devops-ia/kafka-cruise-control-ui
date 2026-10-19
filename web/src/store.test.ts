import { readPref, refreshSeconds, setCluster, setRefresh, cluster, writePref } from "./store";

describe("preferences", () => {
  beforeEach(() => localStorage.clear());

  it("persists the refresh interval and the selected cluster", () => {
    setRefresh(30);
    setCluster("b");
    expect(refreshSeconds.get()).toBe(30);
    expect(cluster.get()).toBe("b");
    expect(localStorage.getItem("ccui.refresh")).toBe("30");
    expect(localStorage.getItem("ccui.cluster")).toBe("b");
  });

  it("falls back when storage is unavailable", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPref("x", "dflt")).toBe("dflt");
    expect(() => writePref("x", "1")).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
