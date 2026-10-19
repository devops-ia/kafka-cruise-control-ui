import { useResource } from "./hooks";


export interface Goals {
  hard: string[];
  soft: string[];
}

// CC does not report which goals are hard, so this is a naming heuristic. It only groups; it never decides
// which goals exist. A goal CC reports that does not match lands in "soft", so custom goals still show up.
const HARD = /(CapacityGoal|RackAware|BrokerSetAware|MinTopicLeadersPerBroker)/;

/** Goals come from the analyzer state of the cluster, never from a list in the client. */
export function goalsFromState(state: any): Goals {
  const analyzer = state?.AnalyzerState ?? {};
  const names: string[] = Array.isArray(analyzer.goalReadiness) ? analyzer.goalReadiness.map((g: any) => g.name) : (analyzer.readyGoals ?? []);
  const unique = [...new Set(names)].sort();
  return { hard: unique.filter((n) => HARD.test(n)), soft: unique.filter((n) => !HARD.test(n)) };
}

export function useGoals(): { goals: Goals | undefined; error?: Error } {
  const res = useResource("state", { substates: "ANALYZER" });
  return { goals: res.data ? goalsFromState(res.data) : undefined, error: res.error };
}
