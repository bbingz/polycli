export const TIMING_SCHEMA_VERSION = 1;
export const TIMING_METRIC_NAMES = ["cold", "ttft", "gen", "tool", "retry", "tail", "total"];
export const TIMING_METRIC_STATUSES = ["measured", "zero", "missing", "unsupported"];
export const TIMING_RUNTIME_PERSISTENCE = ["ephemeral", "session", "daemon"];
export const TIMING_MEASUREMENT_SCOPES = ["request", "turn", "job"];
