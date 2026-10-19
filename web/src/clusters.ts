import { getClusters, type ClusterInfo } from "./api";
import { cluster, createStore, setCluster, useStore } from "./store";

export const clusters = createStore<ClusterInfo[]>([]);
export const useClusters = () => useStore(clusters);

/** Loads the cluster list and makes sure the remembered cluster still exists. */
export async function loadClusters(): Promise<void> {
  const list = await getClusters();
  clusters.set(list);
  if (!list.some((c) => c.name === cluster.get())) setCluster(list[0]?.name ?? "");
}
