import {
  TIMING_MEASUREMENT_SCOPES,
  TIMING_METRIC_NAMES,
  TIMING_RUNTIME_PERSISTENCE,
} from "./constants.js";
import { calculatePercentiles } from "./percentile.js";
import { validateTimingRecord } from "./validate.js";

function createMetricSummary() {
  return {
    contributingCount: 0,
    measuredCount: 0,
    zeroCount: 0,
    missingCount: 0,
    unsupportedCount: 0,
    min: null,
    max: null,
    avg: null,
    p50: null,
    p95: null,
    p99: null,
    values: [],
  };
}

function createProviderSummary() {
  return {
    recordCount: 0,
    runtimePersistenceCounts: Object.fromEntries(TIMING_RUNTIME_PERSISTENCE.map((name) => [name, 0])),
    measurementScopeCounts: Object.fromEntries(TIMING_MEASUREMENT_SCOPES.map((name) => [name, 0])),
    metrics: Object.fromEntries(TIMING_METRIC_NAMES.map((name) => [name, createMetricSummary()])),
  };
}

function finalizeMetric(summary) {
  if (summary.values.length === 0) {
    delete summary.values;
    return summary;
  }

  const stats = calculatePercentiles(summary.values, [50, 95, 99]);
  const total = summary.values.reduce((sum, value) => sum + value, 0);

  summary.min = Math.min(...summary.values);
  summary.max = Math.max(...summary.values);
  summary.avg = total / summary.values.length;
  summary.p50 = stats.p50;
  summary.p95 = stats.p95;
  summary.p99 = stats.p99;
  delete summary.values;
  return summary;
}

export function aggregateTimingRecords(records) {
  const summary = {
    recordCount: 0,
    invalidRecords: [],
    byProvider: {},
  };

  for (const record of records) {
    const validation = validateTimingRecord(record);
    if (!validation.ok) {
      summary.invalidRecords.push({ record, errors: validation.errors });
      continue;
    }

    summary.recordCount += 1;
    const provider = record.provider;
    const providerSummary = summary.byProvider[provider] ?? createProviderSummary();
    providerSummary.recordCount += 1;
    providerSummary.runtimePersistenceCounts[record.runtimePersistence] += 1;
    providerSummary.measurementScopeCounts[record.measurementScope] += 1;
    summary.byProvider[provider] = providerSummary;

    for (const metricName of TIMING_METRIC_NAMES) {
      const metric = record.metrics[metricName];
      const metricSummary = providerSummary.metrics[metricName];

      if (metric.status === "measured") {
        metricSummary.measuredCount += 1;
        metricSummary.contributingCount += 1;
        metricSummary.values.push(metric.ms);
      } else if (metric.status === "zero") {
        metricSummary.zeroCount += 1;
        metricSummary.contributingCount += 1;
        metricSummary.values.push(0);
      } else if (metric.status === "missing") {
        metricSummary.missingCount += 1;
      } else if (metric.status === "unsupported") {
        metricSummary.unsupportedCount += 1;
      }
    }
  }

  for (const providerSummary of Object.values(summary.byProvider)) {
    for (const metricName of TIMING_METRIC_NAMES) {
      providerSummary.metrics[metricName] = finalizeMetric(providerSummary.metrics[metricName]);
    }
  }

  return summary;
}
