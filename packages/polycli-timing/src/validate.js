import {
  TIMING_MEASUREMENT_SCOPES,
  TIMING_METRIC_NAMES,
  TIMING_METRIC_STATUSES,
  TIMING_RUNTIME_PERSISTENCE,
  TIMING_SCHEMA_VERSION,
} from "./constants.js";

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateMetric(name, metric, errors) {
  if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
    errors.push(`metrics.${name} must be an object`);
    return;
  }

  for (const key of Object.keys(metric)) {
    if (key !== "status" && key !== "ms") {
      errors.push(`metrics.${name}.${key} is not allowed`);
    }
  }

  if (!TIMING_METRIC_STATUSES.includes(metric.status)) {
    errors.push(`metrics.${name}.status must be one of ${TIMING_METRIC_STATUSES.join(", ")}`);
    return;
  }

  if (metric.status === "measured") {
    if (!Number.isFinite(metric.ms) || metric.ms <= 0) {
      errors.push(`metrics.${name}.ms must be > 0 when status=measured`);
    }
    return;
  }

  if (metric.status === "zero") {
    if (metric.ms !== 0) {
      errors.push(`metrics.${name}.ms must be 0 when status=zero`);
    }
    return;
  }

  if (metric.ms !== null) {
    errors.push(`metrics.${name}.ms must be null when status=${metric.status}`);
  }
}

export function validateTimingRecord(record) {
  const errors = [];

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, errors: ["record must be an object"] };
  }

  if (record.version !== TIMING_SCHEMA_VERSION) {
    errors.push(`version must be ${TIMING_SCHEMA_VERSION}`);
  }
  if (typeof record.provider !== "string" || record.provider.trim().length === 0) {
    errors.push("provider must be a non-empty string");
  }
  if (!TIMING_RUNTIME_PERSISTENCE.includes(record.runtimePersistence)) {
    errors.push(`runtimePersistence must be one of ${TIMING_RUNTIME_PERSISTENCE.join(", ")}`);
  }
  if (!TIMING_MEASUREMENT_SCOPES.includes(record.measurementScope)) {
    errors.push(`measurementScope must be one of ${TIMING_MEASUREMENT_SCOPES.join(", ")}`);
  }
  if (!isIsoDate(record.completedAt)) {
    errors.push("completedAt must be an ISO-8601 date string");
  }
  if (!record.metrics || typeof record.metrics !== "object" || Array.isArray(record.metrics)) {
    errors.push("metrics must be an object");
  } else {
    for (const metricName of Object.keys(record.metrics)) {
      if (!TIMING_METRIC_NAMES.includes(metricName)) {
        errors.push(`metrics.${metricName} is not allowed`);
      }
    }
    for (const metricName of TIMING_METRIC_NAMES) {
      if (!(metricName in record.metrics)) {
        errors.push(`metrics.${metricName} is required`);
        continue;
      }
      validateMetric(metricName, record.metrics[metricName], errors);
    }
    const total = record.metrics.total;
    if (total && !["measured", "zero"].includes(total.status)) {
      errors.push("metrics.total.status must be measured or zero");
    }
  }

  return { ok: errors.length === 0, errors };
}
