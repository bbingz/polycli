import fs from "node:fs";

import { ensureParentDir, withLockfile, writeFileAtomic } from "./atomic-save.js";

function safeParseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function readNdjson(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
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
  { timeoutMs = 10_000, staleMs = 30_000, pollMs = 25, maxBytes = null, keepRatio = 0.5 } = {}
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
    } catch {
      // new file
    }

    const line = `${needsLeadingNewline ? "\n" : ""}${JSON.stringify(record)}\n`;
    fs.appendFileSync(filePath, line, "utf8");

    if (maxBytes != null) {
      const stat = fs.statSync(filePath);
      if (stat.size > maxBytes) {
        const lines = fs
          .readFileSync(filePath, "utf8")
          .split("\n")
          .filter(Boolean);
        const valid = lines.filter((entry) => safeParseLine(entry) != null);
        const keepFrom = Math.floor(valid.length * (1 - keepRatio));
        const kept = valid.slice(keepFrom);
        writeFileAtomic(filePath, `${kept.join("\n")}\n`, "utf8");
      }
    }

    return true;
  }, { timeoutMs, staleMs, pollMs });
}
