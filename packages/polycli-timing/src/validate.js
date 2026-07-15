import {
  TIMING_MEASUREMENT_SCOPES,
  TIMING_METRIC_NAMES,
  TIMING_METRIC_STATUSES,
  TIMING_RUNTIME_PERSISTENCE,
  TIMING_SCHEMA_VERSION,
} from "./constants.js";

const TIMING_OUTCOMES = ["success", "failure", "timeout", "terminated", "cancelled"];
const RFC3339_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;

function isIsoDate(value) {
  if (typeof value !== "string") return false;

  const match = value.match(RFC3339_DATE_TIME);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? null : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? null : Number(offsetMinuteText);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 60 &&
    (offsetHour === null || (offsetHour <= 23 && offsetMinute <= 59))
  );
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function hasOwn(record, field) {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function validateOptionalString(record, field, errors, { nonEmpty = false } = {}) {
  if (!hasOwn(record, field)) return;

  if (typeof record[field] !== "string" || (nonEmpty && record[field].length === 0)) {
    errors.push(`${field} must be ${nonEmpty ? "a non-empty string" : "a string"}`);
  }
}

function validateDeclaredOptionalFields(record, errors) {
  validateOptionalString(record, "providerVersion", errors);
  validateOptionalString(record, "kind", errors);
  validateOptionalString(record, "terminationReason", errors, { nonEmpty: true });
  validateOptionalString(record, "errorCode", errors, { nonEmpty: true });

  if (hasOwn(record, "outcome") && !TIMING_OUTCOMES.includes(record.outcome)) {
    errors.push(`outcome must be one of ${TIMING_OUTCOMES.join(", ")}`);
  }
  if (hasOwn(record, "exitCode") && !Number.isInteger(record.exitCode)) {
    errors.push("exitCode must be an integer");
  }
  if (hasOwn(record, "responseMatched") && typeof record.responseMatched !== "boolean") {
    errors.push("responseMatched must be a boolean");
  }
  if (hasOwn(record, "meta") && (!record.meta || typeof record.meta !== "object" || Array.isArray(record.meta))) {
    errors.push("meta must be an object");
  }
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
  validateDeclaredOptionalFields(record, errors);
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
