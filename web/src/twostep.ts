import { ApiError, cc } from "./api";
import { createStore } from "./store";

/** CC refuses review_board when two-step verification is off (a 403 today); the status is not worth pinning, the message is. */
export const isTwoStepDisabled = (e: unknown): boolean => e instanceof ApiError && /two\.step\.verification/i.test(e.message);

/** Per cluster name; a missing entry means unknown, and only "off" hides Peer review. */
export const twoStep = createStore<Record<string, "on" | "off">>({});

/** Asks review_board once. Any failure other than the two-step message resets the cluster to unknown (fail open), even over an earlier "off". */
export async function probeTwoStep(cluster: string): Promise<void> {
  let state: "on" | "off" | undefined;
  try {
    await cc(cluster, "review_board");
    state = "on";
  } catch (e) {
    if (isTwoStepDisabled(e)) state = "off";
  }
  const { [cluster]: _old, ...rest } = twoStep.get();
  twoStep.set(state ? { ...rest, [cluster]: state } : rest);
}
