import {
  TIMING_MEASUREMENT_SCOPES,
  TIMING_METRIC_NAMES,
  TIMING_RUNTIME_PERSISTENCE,
} from "./constants.js";
import { calculatePercentiles } from "./percentile.js";
import { validateTimingRecord } from "./validate.js";

const COHORT_DIMENSIONS = Object.freeze([
  "provider",
  "kind",
  "measurementScope",
  "outcome",
  "runtimePersistence",
]);

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
    capability: "unsupported",
    measuredValues: [],
  };
}

function createMetricsSummary() {
  return Object.fromEntries(TIMING_METRIC_NAMES.map((name) => [name, createMetricSummary()]));
}

function createProviderSummary() {
  return {
    recordCount: 0,
    runtimePersistenceCounts: Object.fromEntries(TIMING_RUNTIME_PERSISTENCE.map((name) => [name, 0])),
    measurementScopeCounts: Object.fromEntries(TIMING_MEASUREMENT_SCOPES.map((name) => [name, 0])),
    cohortCount: 0,
    mixedDimensions: [],
    metrics: createMetricsSummary(),
  };
}

function getCohortDimensions(record) {
  return {
    provider: record.provider,
    kind: record.kind ?? null,
    measurementScope: record.measurementScope,
    outcome: record.outcome ?? null,
    runtimePersistence: record.runtimePersistence,
  };
}

function getCohortKey(dimensions) {
  return JSON.stringify(COHORT_DIMENSIONS.map((name) => dimensions[name]));
}

function createCohort(dimensions) {
  return {
    provider: dimensions.provider,
    kind: dimensions.kind,
    measurementScope: dimensions.measurementScope,
    outcome: dimensions.outcome,
    runtimePersistence: dimensions.runtimePersistence,
    recordCount: 0,
    metrics: createMetricsSummary(),
  };
}

function addMetric(metricSummary, metric) {
  if (metric.status === "measured") {
    metricSummary.measuredCount += 1;
    metricSummary.contributingCount += 1;
    metricSummary.measuredValues.push(metric.ms);
  } else if (metric.status === "zero") {
    metricSummary.zeroCount += 1;
    metricSummary.contributingCount += 1;
  } else if (metric.status === "missing") {
    metricSummary.missingCount += 1;
  } else if (metric.status === "unsupported") {
    metricSummary.unsupportedCount += 1;
  }
}

function addRecordMetrics(summary, record) {
  for (const metricName of TIMING_METRIC_NAMES) {
    addMetric(summary.metrics[metricName], record.metrics[metricName]);
  }
}

function finalizeMetric(summary) {
  const supportedCount = summary.measuredCount + summary.zeroCount + summary.missingCount;
  if (summary.unsupportedCount > 0 && supportedCount > 0) {
    summary.capability = "mixed";
  } else if (supportedCount > 0) {
    summary.capability = "supported";
  }

  if (summary.measuredValues.length === 0) {
    delete summary.measuredValues;
    return summary;
  }

  const stats = calculatePercentiles(summary.measuredValues, [50, 95, 99]);
  const total = summary.measuredValues.reduce((sum, value) => sum + value, 0);

  summary.min = Math.min(...summary.measuredValues);
  summary.max = Math.max(...summary.measuredValues);
  summary.avg = total / summary.measuredValues.length;
  summary.p50 = stats.p50;
  summary.p95 = stats.p95;
  summary.p99 = stats.p99;
  delete summary.measuredValues;
  return summary;
}

function finalizeMetrics(summary) {
  for (const metricName of TIMING_METRIC_NAMES) {
    summary.metrics[metricName] = finalizeMetric(summary.metrics[metricName]);
  }
}

function finalizeProviderCohorts(providerSummary, cohorts) {
  providerSummary.cohortCount = cohorts.length;
  providerSummary.mixedDimensions = COHORT_DIMENSIONS.filter(
    (dimension) =>
      dimension !== "provider" && new Set(cohorts.map((cohort) => cohort[dimension])).size > 1
  );
}

export function aggregateTimingRecords(records) {
  const summary = {
    recordCount: 0,
    invalidRecords: [],
    byProvider: {},
    cohortDimensions: [...COHORT_DIMENSIONS],
    cohorts: [],
  };
  const cohortsByKey = new Map();
  const cohortsByProvider = new Map();

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

    const cohortDimensions = getCohortDimensions(record);
    const cohortKey = getCohortKey(cohortDimensions);
    let cohort = cohortsByKey.get(cohortKey);
    if (!cohort) {
      cohort = createCohort(cohortDimensions);
      cohortsByKey.set(cohortKey, cohort);
      summary.cohorts.push(cohort);
      const providerCohorts = cohortsByProvider.get(provider) ?? [];
      providerCohorts.push(cohort);
      cohortsByProvider.set(provider, providerCohorts);
    }
    cohort.recordCount += 1;

    addRecordMetrics(providerSummary, record);
    addRecordMetrics(cohort, record);
  }

  for (const [provider, providerSummary] of Object.entries(summary.byProvider)) {
    finalizeMetrics(providerSummary);
    finalizeProviderCohorts(providerSummary, cohortsByProvider.get(provider) ?? []);
  }
  for (const cohort of summary.cohorts) {
    finalizeMetrics(cohort);
  }

  return summary;
}
