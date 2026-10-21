// Shapes follow Cruise Control 3.x responses (yaml/responses in the CC source).
export const load = {
  version: 1,
  brokers: [
    { Broker: 0, Host: "kafka-0", Rack: "r1", BrokerState: "ALIVE", CpuPct: 12.5, DiskPct: 40, DiskMB: 1024, LeaderNwInRate: 100, FollowerNwInRate: 50, NwOutRate: 300, Replicas: 120, Leaders: 40 },
    { Broker: 1, Host: "kafka-1", Rack: "r2", BrokerState: "ALIVE", CpuPct: 75, DiskPct: 91, DiskMB: 5120, LeaderNwInRate: 200, FollowerNwInRate: 80, NwOutRate: 400, Replicas: 80, Leaders: 30, DiskState: { "/data/a": { NumReplicas: 50, NumLeaderReplicas: 20, DiskMB: 2048, DiskPct: 40 }, "/data/b": { NumReplicas: 30, NumLeaderReplicas: 10, DiskMB: 0, DiskPct: "DEAD" } } },
  ],
  hosts: [{ Host: "kafka-0", Rack: "r1", CpuPct: 12.5, DiskPct: 40, DiskMB: 1024, LeaderNwInRate: 100, FollowerNwInRate: 50, NwOutRate: 300, Replicas: 120, Leaders: 40 }],
};

export const clusterState = {
  version: 1,
  KafkaBrokerState: {
    Summary: { Brokers: 2, Topics: 5, Replicas: 200, Leaders: 70 },
    LeaderCountByBrokerId: { "0": 40, "1": 30 },
    ReplicaCountByBrokerId: { "0": 120, "1": 80 },
    OutOfSyncCountByBrokerId: { "0": 0, "1": 2 },
    OfflineReplicaCountByBrokerId: { "0": 0, "1": 0 },
    IsController: { "0": true, "1": false },
    OfflineLogDirsByBrokerId: { "0": [], "1": [] },
  },
  KafkaPartitionState: { offline: [], urp: [{ topic: "orders", partition: 3, leader: 0, replicas: [0, 1], "in-sync": [0], "out-of-sync": [1] }], "with-offline-replicas": [], "under-min-isr": [], other: [] },
};

export const ccState = {
  version: 1,
  MonitorState: { state: "RUNNING", numValidPartitions: 100 },
  ExecutorState: { state: "NO_TASK_IN_PROGRESS" },
  AnalyzerState: {
    isProposalReady: true,
    readyGoals: ["RackAwareGoal", "DiskCapacityGoal", "MyCustomGoal"],
    goalReadiness: [
      { name: "RackAwareGoal", status: "ready" },
      { name: "DiskCapacityGoal", status: "ready" },
      { name: "ReplicaDistributionGoal", status: "notReady" },
      { name: "MyCustomGoal", status: "ready" },
    ],
  },
  AnomalyDetectorState: {
    selfHealingEnabled: ["BROKER_FAILURE"],
    selfHealingDisabled: ["GOAL_VIOLATION"],
    selfHealingEnabledRatio: { BROKER_FAILURE: 1, GOAL_VIOLATION: 0.5 },
    metrics: { meanTimeToStartFixMs: 90000, numSelfHealingStarted: 4, numSelfHealingFailedToStart: 1 },
    balancednessScore: 97.5,
  },
};

export const optimization = {
  version: 1,
  summary: { numReplicaMovements: 12, dataToMoveMB: 2048, numLeaderMovements: 3, numIntraBrokerReplicaMovements: 0, onDemandBalancednessScoreBefore: 80, onDemandBalancednessScoreAfter: 95 },
  goalSummary: [{ goal: "RackAwareGoal", status: "NO-ACTION" }, { goal: "DiskUsageDistributionGoal", status: "VIOLATED" }],
};

// Shapes follow the legacy UI sources (InterBrokerMovementTable, LoadDiffTable, Executor); not yet checked against a live CC 3.x.
const tp = (topic: string, partition: number) => ({ topicPartition: { topic, partition } });
const loadBefore = {
  brokers: [
    { Broker: 0, Host: "kafka-0", BrokerState: "ALIVE", Replicas: 120, Leaders: 40, CpuPct: 12.5, DiskMB: 1024, LeaderNwInRate: 100, FollowerNwInRate: 50, NwOutRate: 300, DiskState: { "/data/a": { NumReplicas: 120, NumLeaderReplicas: 40, DiskMB: 1024, DiskPct: 10 } } },
    { Broker: 1, Host: "kafka-1", BrokerState: "ALIVE", Replicas: 80, Leaders: 30, CpuPct: 75, DiskMB: 5120, LeaderNwInRate: 200, FollowerNwInRate: 80, NwOutRate: 400 },
  ],
  hosts: [{ Host: "kafka-1", Replicas: 80, Leaders: 30, CpuPct: 75, DiskMB: 5120, LeaderNwInRate: 200, FollowerNwInRate: 80, NwOutRate: 400 }],
};
const loadAfter = {
  brokers: [
    { Broker: 0, Host: "kafka-0", BrokerState: "ALIVE", Replicas: 120, Leaders: 40, CpuPct: 12.5, DiskMB: 1024, LeaderNwInRate: 100, FollowerNwInRate: 50, NwOutRate: 300, DiskState: { "/data/a": { NumReplicas: 120, NumLeaderReplicas: 40, DiskMB: 1024, DiskPct: 10 }, "/data/b": { NumReplicas: 0, NumLeaderReplicas: 0, DiskMB: 0, DiskPct: "DEAD" } } },
    { Broker: 1, Host: "kafka-1", BrokerState: "ALIVE", Replicas: 70, Leaders: 30, CpuPct: 50, DiskMB: 4096, LeaderNwInRate: 200, FollowerNwInRate: 80, NwOutRate: 300 },
    { Broker: 2, Host: "kafka-2", BrokerState: "NEW", Replicas: 10, Leaders: 0, CpuPct: 5, DiskMB: 100, LeaderNwInRate: 0, FollowerNwInRate: 0, NwOutRate: 0 },
  ],
  hosts: [{ Host: "kafka-1", Replicas: 70, Leaders: 30, CpuPct: 50, DiskMB: 4096, LeaderNwInRate: 200, FollowerNwInRate: 80, NwOutRate: 300 }],
};
export const optimizationVerbose = {
  ...optimization,
  proposals: [{ ...tp("orders", 3), oldReplicas: [0, 1], newReplicas: [0, 2] }, { ...tp("payments", 0), oldReplicas: [1], newReplicas: [2] }],
  loadBeforeOptimization: loadBefore,
  loadAfterOptimization: loadAfter,
};

export const ccStateIntra = {
  ...ccState,
  ExecutorState: {
    state: "INTRA_BROKER_REPLICA_MOVEMENT_TASK_IN_PROGRESS",
    inProgressIntraBrokerPartitionMovement: [{ brokerId: 1, proposal: tp("orders", 3) }],
    pendingIntraBrokerPartitionMovement: [
      { state: "PENDING", brokerId: 2, proposal: tp("payments", 0) },
      { state: "IN_PROGRESS", brokerId: 1, proposal: tp("payments", 1) },
    ],
  },
};

export const userTasks = {
  version: 1,
  userTasks: [
    { UserTaskId: "t-1", RequestURL: "POST /kafkacruisecontrol/rebalance?dryrun=true", ClientIdentity: "10.0.0.1", StartMs: 1760000000000, Status: "Completed" },
    { UserTaskId: "t-2", RequestURL: "GET /kafkacruisecontrol/state", ClientIdentity: "10.0.0.2", StartMs: 1760000100000, Status: "Active" },
  ],
};
