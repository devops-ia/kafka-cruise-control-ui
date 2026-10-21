import { useState } from "preact/hooks";
import { Async } from "../components/Async";
import { OptimizationView } from "../components/Results";
import { useResource } from "../hooks";

export function Proposals() {
  const [disks, setDisks] = useState(false);
  const res = useResource("proposals", { verbose: true, rebalance_disk: disks || undefined });
  const controls = (
    <form class="inline-form" onSubmit={(e) => e.preventDefault()}>
      <label>
        <input type="checkbox" checked={disks} onChange={(e) => setDisks((e.target as HTMLInputElement).checked)} /> Intra-broker rebalance disk proposal
      </label>
    </form>
  );
  return (
    <Async title="Proposals" res={res} controls={controls}>
      {(d) => <OptimizationView data={d} />}
    </Async>
  );
}
