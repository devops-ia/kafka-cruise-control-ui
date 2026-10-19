import { Async } from "../components/Async";
import { OptimizationView } from "../components/Results";
import { useResource } from "../hooks";

export function Proposals() {
  const res = useResource("proposals", { verbose: true });
  return (
    <Async title="Proposals" res={res}>
      {(d) => <OptimizationView data={d} />}
    </Async>
  );
}
