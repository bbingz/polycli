#!/usr/bin/env node
// Opt-in fixture-staleness checker. Compares each captured fixture's pinned
// CLI `version` (meta.json) to the locally-installed CLI's reported version.
//
// WARN-only by default: staleness is expected during normal upstream drift
// and must NOT block local work, so this exits 0 even when fixtures are stale.
// Use --strict (e.g. before a release) to exit non-zero on a real STALE row.
// When a CLI is absent (ENOENT) or its version probe errors, the row is a
// SKIP (warning), never a failure — mirrors scripts/check-review-cli-drift.mjs.
//
// Wired into release:check in strict mode. It remains developer-machine
// specific, so unavailable or unprobeable CLIs are explicit skips.
//
// Version-flag deviations (confirmed against memory reference_cli_provider_versions
// and the installed CLIs):
//   - gemini uses `-v`, NOT `--version`.
//   - kimi uses `-V` (capital V), NOT `-v`.
//   - minimax fixtures use the current mmx CLI. The bin resolution mirrors the
//     drift script for consistency and honors MMX_CLI_BIN/MINIMAX_CLI_BIN.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_FIXTURE_ROOT = path.join(REPO_ROOT, "packages/polycli-runtime/test/fixtures");

const VERSION_TOKEN_RE = /\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?/;
const UTC_ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LIFECYCLE_TIMESTAMP_FIELDS = Object.freeze({
  retired: "retiredAt",
  archived: "archivedAt",
});

// Per-provider version probe. Bin resolution mirrors check-review-cli-drift.mjs
// (incl. MMX_CLI_BIN/MINIMAX_CLI_BIN/AGY_CLI_BIN env overrides).
export const PROVIDER_VERSION_PROBES = {
  claude: { bin: "claude", versionArgs: ["--version"] },
  gemini: { bin: "gemini", versionArgs: ["-v"] },
  qwen: { bin: "qwen", versionArgs: ["--version"] },
  copilot: { bin: "copilot", versionArgs: ["--version"] },
  opencode: { bin: "opencode", versionArgs: ["--version"] },
  opencode2: { bin: process.env.OPENCODE2_CLI_BIN || "opencode2", versionArgs: ["--version"] },
  pi: { bin: "pi", versionArgs: ["--version"] },
  kimi: { bin: "kimi", versionArgs: ["-V"] },
  minimax: {
    bin: process.env.MMX_CLI_BIN || process.env.MINIMAX_CLI_BIN || "mmx",
    versionArgs: ["--version"],
  },
  cmd: { bin: process.env.CMD_CLI_BIN || "cmd", versionArgs: ["--version"] },
  agy: { bin: process.env.AGY_CLI_BIN || "agy", versionArgs: ["--version"] },
  grok: { bin: process.env.GROK_CLI_BIN || "grok", versionArgs: ["--version"] },
};

// Extract a semver-ish token, including prereleases, from heterogeneous CLI output,
// e.g. "2.1.147 (Claude Code)", "gemini version 0.43.1", or
// "opencode2 v0.0.0-next-15493".
export function extractVersionToken(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  const match = text.match(VERSION_TOKEN_RE);
  return match ? match[0] : null;
}

// Compare a fixture's pinned version string to the installed CLI's output.
// Both are reduced to their semver token before comparison.
export function compareFixtureVersion({ pinned, installed }) {
  const pinnedToken = extractVersionToken(pinned);
  const installedToken = extractVersionToken(installed);
  if (pinnedToken === null || installedToken === null) {
    return { status: "unknown", pinned: pinnedToken, installed: installedToken };
  }
  return {
    status: pinnedToken === installedToken ? "ok" : "stale",
    pinned: pinnedToken,
    installed: installedToken,
  };
}

function walkMetaFiles(root, current = root) {
  const entries = fs.readdirSync(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMetaFiles(root, entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".meta.json")) {
      files.push(path.relative(root, entryPath).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function defaultSpawn(bin, args) {
  return spawnSync(bin, args, { encoding: "utf8", timeout: 10_000 });
}

// Walk fixture meta files, probe each provider's installed CLI version, and
// classify each row as ok / stale / retired / archived / skipped / unknown. `spawnFn` is injectable
// so unit tests run without any installed CLI.
export function checkFixtureFreshness({ fixtureRoot = DEFAULT_FIXTURE_ROOT, spawnFn = defaultSpawn } = {}) {
  const metaFiles = walkMetaFiles(fixtureRoot);
  const probeCache = new Map();
  const rows = [];

  for (const relativePath of metaFiles) {
    const filePath = path.join(fixtureRoot, relativePath);
    const meta = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const provider = meta.provider;
    const lifecycle = getExcludedLifecycle(meta);
    if (lifecycle) {
      rows.push({
        provider,
        fixture: relativePath,
        status: lifecycle.status,
        reason: lifecycle.reason,
        timestamp: lifecycle.timestamp,
      });
      continue;
    }
    const probe = PROVIDER_VERSION_PROBES[provider];

    if (!probe) {
      rows.push({ provider, fixture: relativePath, status: "skipped", reason: "no version probe configured" });
      continue;
    }

    if (!probeCache.has(provider)) {
      probeCache.set(provider, runProbe(probe, spawnFn));
    }
    const probed = probeCache.get(provider);

    if (probed.skipped) {
      rows.push({ provider, fixture: relativePath, status: "skipped", reason: probed.reason });
      continue;
    }

    const comparison = compareFixtureVersion({ pinned: meta.version, installed: probed.installed });
    rows.push({
      provider,
      fixture: relativePath,
      status: comparison.status,
      pinned: comparison.pinned,
      installed: comparison.installed,
      rawInstalled: probed.installed,
    });
  }

  return {
    rows,
    stale: rows.filter((r) => r.status === "stale"),
    retired: rows.filter((r) => r.status === "retired"),
    archived: rows.filter((r) => r.status === "archived"),
    skipped: rows.filter((r) => r.status === "skipped"),
    unknown: rows.filter((r) => r.status === "unknown"),
  };
}

function getExcludedLifecycle(meta) {
  const lifecycle = meta?.lifecycle;
  const timestampField = LIFECYCLE_TIMESTAMP_FIELDS[lifecycle?.status];
  if (!timestampField) return null;
  if (typeof lifecycle.reason !== "string" || !lifecycle.reason.trim()) return null;
  if (!isCanonicalUtcIsoTimestamp(lifecycle[timestampField])) return null;
  return { status: lifecycle.status, reason: lifecycle.reason, timestamp: lifecycle[timestampField] };
}

function isCanonicalUtcIsoTimestamp(value) {
  if (typeof value !== "string" || !UTC_ISO_TIMESTAMP_RE.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function runProbe(probe, spawnFn) {
  let result;
  try {
    result = spawnFn(probe.bin, probe.versionArgs);
  } catch (error) {
    return { skipped: true, reason: error.message };
  }
  if (result?.error) {
    if (result.error.code === "ENOENT") {
      return { skipped: true, reason: "not installed" };
    }
    return { skipped: true, reason: result.error.message };
  }
  const text = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`.trim();
  return { skipped: false, installed: text };
}

function formatRow(row) {
  switch (row.status) {
    case "ok":
      return `[ ok     ] ${row.fixture} — ${row.installed}`;
    case "skipped":
      return `[ skip   ] ${row.fixture} — ${row.reason}`;
    case "unknown":
      return `[ ?      ] ${row.fixture} — could not parse version (pinned ${row.pinned ?? "?"}, installed ${row.installed ?? "?"})`;
    case "stale":
      return `[ STALE  ] ${row.fixture} — pinned ${row.pinned}, installed ${row.installed} — re-capture`;
    case "retired":
      return `[ retired] ${row.fixture} — ${row.reason} (retired ${row.timestamp})`;
    case "archived":
      return `[ archived] ${row.fixture} — ${row.reason} (archived ${row.timestamp})`;
    default:
      return `[ ??     ] ${row.fixture}`;
  }
}

function main() {
  const strict = process.argv.includes("--strict");
  const report = checkFixtureFreshness();

  console.log("Fixture freshness check — compares captured fixture versions to installed CLIs.\n");
  for (const row of report.rows) {
    console.log(`  ${formatRow(row)}`);
  }
  console.log("");

  if (report.stale.length > 0) {
    console.log(
      `${report.stale.length} stale fixture${report.stale.length === 1 ? "" : "s"} detected. Re-capture against the installed CLI version (see packages/polycli-runtime/test/fixtures/<provider>).`,
    );
  } else {
    console.log("No stale fixtures detected against installed CLIs.");
  }
  if (report.skipped.length > 0) {
    console.log(
      `${report.skipped.length} fixture${report.skipped.length === 1 ? "" : "s"} skipped (CLI not installed or unprobeable locally).`,
    );
  }
  if (report.retired.length > 0) {
    console.log(
      `${report.retired.length} retired fixture${report.retired.length === 1 ? "" : "s"} retained for parser replay and excluded from freshness drift.`,
    );
  }
  if (report.archived.length > 0) {
    console.log(
      `${report.archived.length} archived fixture${report.archived.length === 1 ? "" : "s"} retained for parser replay and excluded from freshness drift until explicitly reactivated.`,
    );
  }

  if (strict && report.stale.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
