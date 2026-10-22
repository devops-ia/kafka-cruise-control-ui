import { ApiError } from "./api";
import { isTwoStepDisabled, probeTwoStep, twoStep } from "./twostep";
import { mockFetch, proxyPath } from "./testutil";

afterEach(() => {
  vi.unstubAllGlobals();
  twoStep.set({});
});

const MSG = "Cannot process GET request '/kafkacruisecontrol/review_board' due to: 'Attempt to access REVIEW_BOARD endpoint without enabling 'two.step.verification.enabled' config.'.";

describe("isTwoStepDisabled", () => {
  it("matches only an ApiError that names two.step.verification", () => {
    expect(isTwoStepDisabled(new ApiError(403, MSG))).toBe(true);
    expect(isTwoStepDisabled(new ApiError(500, "boom"))).toBe(false);
    expect(isTwoStepDisabled(new Error(MSG))).toBe(false);
  });
});

describe("probeTwoStep", () => {
  const probe = async (reply: { status?: number; body?: unknown } | "network", name = "a") => {
    if (reply === "network") vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    else mockFetch((c) => (c.path === proxyPath(name, "review_board") ? reply : undefined));
    await probeTwoStep(name);
    return twoStep.get();
  };

  it("records on for a 2xx", async () => expect(await probe({ body: { RequestInfo: [] } })).toEqual({ a: "on" }));
  it("records off for the two.step.verification error", async () => expect(await probe({ status: 403, body: { errorMessage: MSG } })).toEqual({ a: "off" }));
  it.each([502, 504, 401, 500])("leaves the state unknown for %s", async (status) => expect(await probe({ status, body: { error: "x" } })).toEqual({}));
  it("leaves the state unknown on a network failure", async () => expect(await probe("network")).toEqual({}));
  it("resets an earlier off to unknown when a later probe is inconclusive", async () => {
    await probe({ status: 403, body: { errorMessage: MSG } });
    expect(await probe({ status: 502, body: { error: "bad gateway" } })).toEqual({});
  });
  it("keeps one entry per cluster", async () => {
    await probe({ status: 403, body: { errorMessage: MSG } }, "a");
    expect(await probe({ body: {} }, "b")).toEqual({ a: "off", b: "on" });
  });
});
