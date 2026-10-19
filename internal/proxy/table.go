// Parameter lists mirror cruise-control/src/main/resources/yaml/endpoints/*.yaml; endpoints_test.go fails when they drift.

package proxy

// table lists every endpoint the proxy forwards with the query parameters the client may send.
// json and doAs are set by the proxy and never accepted from the client.
var table = map[string]Endpoint{
	"add_broker":              {Method: "POST", Params: params("brokerid dryrun throttle_added_broker allow_capacity_estimation goals concurrent_partition_movements_per_broker max_partition_movements_in_cluster concurrent_leader_movements broker_concurrent_leader_movements skip_hard_goal_check excluded_topics kafka_assigner use_ready_default_goals verbose exclude_recently_demoted_brokers exclude_recently_removed_brokers replica_movement_strategies execution_progress_check_interval_ms stop_ongoing_execution reason review_id data_from replication_throttle fast_mode")},
	"admin":                   {Method: "POST", Params: params("disable_self_healing_for enable_self_healing_for concurrent_partition_movements_per_broker max_partition_movements_in_cluster concurrent_intra_broker_partition_movements concurrent_leader_movements broker_concurrent_leader_movements drop_recently_removed_brokers drop_recently_demoted_brokers execution_progress_check_interval_ms review_id disable_concurrency_adjuster_for enable_concurrency_adjuster_for min_isr_based_concurrency_adjustment reason")},
	"bootstrap":               {Method: "GET", Params: params("start end clearmetrics developer_mode")},
	"demote_broker":           {Method: "POST", Params: params("brokerid dryrun concurrent_leader_movements broker_concurrent_leader_movements allow_capacity_estimation skip_urp_demotion exclude_follower_demotion verbose exclude_recently_demoted_brokers replica_movement_strategies brokerid_and_logdirs replication_throttle reason execution_progress_check_interval_ms stop_ongoing_execution review_id")},
	"fix_offline_replicas":    {Method: "POST", Params: params("dryrun goals allow_capacity_estimation concurrent_partition_movements_per_broker max_partition_movements_in_cluster concurrent_leader_movements broker_concurrent_leader_movements skip_hard_goal_check excluded_topics use_ready_default_goals data_from verbose exclude_recently_demoted_brokers exclude_recently_removed_brokers replica_movement_strategies review_id replication_throttle execution_progress_check_interval_ms reason stop_ongoing_execution fast_mode")},
	"kafka_cluster_state":     {Method: "GET", Params: params("topic verbose reason")},
	"load":                    {Method: "GET", Params: params("start end time allow_capacity_estimation populate_disk_info capacity_only reason")},
	"partition_load":          {Method: "GET", Params: params("resource start end entries topic partition min_valid_partition_ratio allow_capacity_estimation max_load avg_load brokerid reason")},
	"pause_sampling":          {Method: "POST", Params: params("reason review_id")},
	"permissions":             {Method: "GET", Params: params("reason")},
	"proposals":               {Method: "GET", Params: params("kafka_assigner destination_broker_ids ignore_proposal_cache rebalance_disk data_from use_ready_default_goals excluded_topics exclude_recently_removed_brokers goals allow_capacity_estimation verbose exclude_recently_demoted_brokers fast_mode reason")},
	"rebalance":               {Method: "POST", Params: params("dryrun goals allow_capacity_estimation stop_ongoing_execution concurrent_partition_movements_per_broker max_partition_movements_in_cluster concurrent_intra_broker_partition_movements concurrent_leader_movements broker_concurrent_leader_movements skip_hard_goal_check excluded_topics use_ready_default_goals data_from verbose exclude_recently_demoted_brokers exclude_recently_removed_brokers replica_movement_strategies ignore_proposal_cache destination_broker_ids kafka_assigner rebalance_disk review_id replication_throttle execution_progress_check_interval_ms reason fast_mode")},
	"remove_broker":           {Method: "POST", Params: params("brokerid dryrun throttle_removed_broker goals allow_capacity_estimation concurrent_partition_movements_per_broker max_partition_movements_in_cluster concurrent_leader_movements broker_concurrent_leader_movements skip_hard_goal_check excluded_topics kafka_assigner use_ready_default_goals verbose exclude_recently_demoted_brokers exclude_recently_removed_brokers replica_movement_strategies destination_broker_ids execution_progress_check_interval_ms stop_ongoing_execution reason review_id data_from replication_throttle fast_mode")},
	"remove_disks":            {Method: "POST", Params: params("dryrun stop_ongoing_execution reason brokerid_and_logdirs")},
	"resume_sampling":         {Method: "POST", Params: params("reason review_id")},
	"review":                  {Method: "POST", Params: params("approve discard reason")},
	"review_board":            {Method: "GET", Params: params("review_ids")},
	"rightsize":               {Method: "POST", Params: params("num_brokers_to_add partition_count topic reason")},
	"state":                   {Method: "GET", Params: params("substates verbose super_verbose reason")},
	"stop_proposal_execution": {Method: "POST", Params: params("force_stop stop_external_agent review_id reason")},
	"topic_configuration":     {Method: "POST", Params: params("dryrun topic replication_factor data_from goals allow_capacity_estimation concurrent_partition_movements_per_broker max_partition_movements_in_cluster concurrent_leader_movements broker_concurrent_leader_movements skip_hard_goal_check exclude_recently_demoted_brokers exclude_recently_removed_brokers excluded_topics execution_progress_check_interval_ms reason replica_movement_strategies replication_throttle review_id skip_rack_awareness_check stop_ongoing_execution use_ready_default_goals verbose fast_mode")},
	"train":                   {Method: "GET", Params: params("start end")},
	"user_tasks":              {Method: "GET", Params: params("client_ids endpoints entries types user_task_ids fetch_completed_task reason")},
}
