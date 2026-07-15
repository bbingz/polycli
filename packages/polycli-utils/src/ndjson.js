import fs from "node:fs";

import { ensureParentDir, withLockfile, writeFileAtomic } from "./atomic-save.js";

function safeParseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function retainCompactedLines(lines, keepFrom, retentionGroupKey) {
  const entries = [];
  for (const line of lines) {
    const record = safeParseLine(line);
    if (record != null) {
      entries.push({ line, record });
    }
  }

  if (typeof retentionGroupKey !== "function") {
    return entries.slice(keepFrom).map((entry) => entry.line);
  }

  const grouped = entries.map((entry) => ({
    ...entry,
    retentionGroup: retentionGroupKey(entry.record),
  }));
  const retainedStart = keepFrom < 0
    ? Math.max(0, grouped.length + keepFrom)
    : Math.min(keepFrom, grouped.length);
  const retainedGroups = new Set(
    grouped
      .slice(keepFrom)
      .map((entry) => entry.retentionGroup)
      .filter((group) => group != null),
  );
  return grouped
    .filter((entry, index) => index >= retainedStart
      || (entry.retentionGroup != null && retainedGroups.has(entry.retentionGroup)))
    .map((entry) => entry.line);
}

function chmodIfRequested(filePath, mode) {
  if (mode === 0o666) return;
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // best-effort hardening for existing files
  }
}

export function readNdjson(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  if (text.length === 0) {
    return [];
  }

  const records = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = safeParseLine(trimmed);
    if (parsed != null) {
      records.push(parsed);
    }
  }
  return records;
}

export function tailNdjson(filePath, count) {
  if (!Number.isInteger(count) || count <= 0) {
    return [];
  }
  const records = readNdjson(filePath);
  return records.slice(-count);
}

export function appendNdjson(
  filePath,
  record,
  {
    timeoutMs = 10_000,
    staleMs = 30_000,
    pollMs = 25,
    maxBytes = null,
    keepRatio = 0.5,
    retentionGroupKey = null,
    mode = 0o666,
  } = {}
) {
  const lockPath = `${filePath}.lock`;
  return withLockfile(lockPath, () => {
    ensureParentDir(filePath);

    let needsLeadingNewline = false;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 0) {
        const fd = fs.openSync(filePath, "r");
        const lastByte = Buffer.alloc(1);
        try {
          fs.readSync(fd, lastByte, 0, 1, stat.size - 1);
        } finally {
          fs.closeSync(fd);
        }
        needsLeadingNewline = lastByte[0] !== 0x0a;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const line = `${needsLeadingNewline ? "\n" : ""}${JSON.stringify(record)}\n`;
    fs.appendFileSync(filePath, line, { encoding: "utf8", mode });
    chmodIfRequested(filePath, mode);

    if (maxBytes != null) {
      const stat = fs.statSync(filePath);
      if (stat.size > maxBytes) {
        const lines = fs
          .readFileSync(filePath, "utf8")
          .split("\n")
          .filter(Boolean);
        const validCount = lines.reduce((count, entry) => count + (safeParseLine(entry) != null ? 1 : 0), 0);
        const keepFrom = Math.floor(validCount * (1 - keepRatio));
        const kept = retainCompactedLines(lines, keepFrom, retentionGroupKey);
        writeFileAtomic(filePath, `${kept.join("\n")}\n`, { encoding: "utf8", mode });
        chmodIfRequested(filePath, mode);
      }
    }

    return true;
  }, { timeoutMs, staleMs, pollMs });
}

export function appendNdjsonBatch(
  filePath,
  records,
  {
    timeoutMs = 10_000,
    staleMs = 30_000,
    pollMs = 25,
    maxBytes = null,
    keepRatio = 0.5,
    retentionGroupKey = null,
    mode = 0o666,
  } = {}
) {
  if (!Array.isArray(records)) {
    throw new TypeError("records must be an array");
  }
  if (records.length === 0) {
    return true;
  }

  const serializedBatch = records.map((record) => {
    const serialized = JSON.stringify(record);
    if (typeof serialized !== "string") {
      throw new TypeError("each record must be JSON-serializable");
    }
    return serialized;
  });
  const batch = `${serializedBatch.join("\n")}\n`;
  const lockPath = `${filePath}.lock`;
  return withLockfile(lockPath, () => {
    ensureParentDir(filePath);

    let text = "";
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    let nextText = `${text}${text.length > 0 && !text.endsWith("\n") ? "\n" : ""}${batch}`;
    if (maxBytes != null && Buffer.byteLength(nextText, "utf8") > maxBytes) {
      const existing = text.split("\n").filter((entry) => safeParseLine(entry) != null);
      // A batch is a logical transaction: compaction may evict older records, but may never
      // evict one member of the just-published batch. If the batch alone exceeds maxBytes, keep
      // it whole and let the file temporarily exceed the soft retention bound.
      const targetCount = Math.max(
        serializedBatch.length,
        Math.ceil((existing.length + serializedBatch.length) * keepRatio),
      );
      const allLines = [...existing, ...serializedBatch];
      const keepFrom = Math.max(0, allLines.length - targetCount);
      const kept = retainCompactedLines(allLines, keepFrom, retentionGroupKey);
      nextText = `${kept.join("\n")}\n`;
    }

    writeFileAtomic(filePath, nextText, { encoding: "utf8", mode });
    chmodIfRequested(filePath, mode);
    return true;
  }, { timeoutMs, staleMs, pollMs });
}
