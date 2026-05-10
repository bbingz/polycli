import path from "node:path";

import { aggregateTimingRecords, validateTimingRecord } from "@bbingz/polycli-timing";
import { appendNdjson, readNdjson } from "@bbingz/polycli-utils/ndjson";

import {
  computeWorkspaceSlug,
  describeStateRoot,
  ensureStateDir,
  resolveStateDir,
} from "./state.mjs";

const TIMING_FILE_NAME = "timings.ndjson";
const MAX_TIMING_BYTES = 2_000_000;

export function resolveTimingHistoryFile(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), TIMING_FILE_NAME);
}

export function describeTimingStore(workspaceRoot) {
  const root = describeStateRoot();
  return {
    stateRoot: root.stateRoot,
    stateRootSource: root.source,
    workspaceRoot,
    workspaceSlug: computeWorkspaceSlug(workspaceRoot),
    stateDir: resolveStateDir(workspaceRoot),
    timingFile: resolveTimingHistoryFile(workspaceRoot),
  };
}

export function appendTimingRecord(workspaceRoot, record) {
  const validation = validateTimingRecord(record);
  if (!validation.ok) {
    throw new Error(`Invalid timing record: ${validation.errors.join("; ")}`);
  }
  ensureStateDir(workspaceRoot);
  appendNdjson(resolveTimingHistoryFile(workspaceRoot), record, {
    maxBytes: MAX_TIMING_BYTES,
    keepRatio: 0.5,
  });
  return true;
}

export function listTimingRecords(workspaceRoot, { provider = null, limit = null } = {}) {
  const all = readNdjson(resolveTimingHistoryFile(workspaceRoot))
    .filter((record) => validateTimingRecord(record).ok)
    .filter((record) => !provider || record.provider === provider)
    .sort((left, right) => String(right.completedAt || "").localeCompare(String(left.completedAt || "")));

  if (limit == null) {
    return all;
  }
  return all.slice(0, limit);
}

export function summarizeTimingRecords(records) {
  return aggregateTimingRecords(records);
}
