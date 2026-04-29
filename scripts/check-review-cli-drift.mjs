#!/usr/bin/env node
// Check whether the provider CLI flags that /review depends on still exist
// in the locally-installed CLI versions. Run before cutting a release or
// whenever you suspect an upstream CLI has changed its flag surface.
//
// Not wired into CI: depends on installed CLIs, which are developer-machine
// specific. Skipped CLIs are reported as warnings, not failures.
//
// Source of truth for expected flags: docs/archive/review-cli-flags.md (P1-I decision).

import { spawnSync } from "node:child_process";
import process from "node:process";

const CHECKS = [
  {
    provider: "claude",
    bin: "claude",
    helpArgs: ["--help"],
    expect: ["--tools"],
    notes: "Review hard constraint uses --tools \"\" to deny all tools.",
  },
  {
    provider: "gemini",
    bin: "gemini",
    helpArgs: ["--help"],
    expect: ["--approval-mode", "--policy"],
    notes: "Review hard constraint writes a Policy Engine TOML and passes --policy <file>; --approval-mode plan is the read-only mode.",
  },
  {
    provider: "copilot",
    bin: "copilot",
    helpArgs: ["--help"],
    expect: ["--excluded-tools"],
    notes: "Review hard constraint uses --excluded-tools <list>; empty --available-tools is normalized away by copilot's own parser so cannot be used.",
  },
  {
    provider: "opencode",
    bin: "opencode",
    helpArgs: ["--help"],
    expect: ["--agent"],
    notes: "Review hard constraint uses --agent plan plus injected OPENCODE_CONFIG_CONTENT env var with permission: \"deny\" (env path cannot be --help-verified).",
  },
  {
    provider: "pi",
    bin: "pi",
    helpArgs: ["--help"],
    expect: ["--no-tools"],
    notes: "Review hard constraint uses --no-tools.",
  },
];

const ENV_ONLY = [
  {
    provider: "minimax",
    envVar: "MINI_AGENT_CONFIG_PATH",
    notes: "Review hard constraint writes a one-shot YAML and points MINI_AGENT_CONFIG_PATH at it. No CLI flag to verify; monitor mini-agent release notes for env-var renames.",
  },
  {
    provider: "opencode (env path)",
    envVar: "OPENCODE_CONFIG_CONTENT",
    notes: "Review hard constraint injects permission: \"deny\" via OPENCODE_CONFIG_CONTENT. Env-var based; monitor opencode release notes for renames.",
  },
];

function probe({ bin, helpArgs }) {
  try {
    const result = spawnSync(bin, helpArgs, {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.error) {
      if (result.error.code === "ENOENT") {
        return { skipped: true, reason: "not installed" };
      }
      return { skipped: true, reason: result.error.message };
    }
    // Some CLIs print --help to stderr; accept either.
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    return { text };
  } catch (error) {
    return { skipped: true, reason: error.message };
  }
}

function check(entry) {
  const { provider, expect, notes } = entry;
  const result = probe(entry);
  if (result.skipped) {
    return { provider, status: "skipped", reason: result.reason, notes };
  }
  const missing = expect.filter((flag) => !result.text.includes(flag));
  if (missing.length === 0) {
    return { provider, status: "ok" };
  }
  return { provider, status: "drift", missing, notes };
}

function formatRow({ provider, status, reason, missing, notes }) {
  switch (status) {
    case "ok":
      return `[ ok     ] ${provider}`;
    case "skipped":
      return `[ skip   ] ${provider} — ${reason}`;
    case "drift":
      return [
        `[ DRIFT  ] ${provider} — missing: ${missing.join(", ")}`,
        `           ${notes}`,
      ].join("\n");
    default:
      return `[ ??     ] ${provider}`;
  }
}

function main() {
  const results = CHECKS.map((entry) => check(entry));
  const envReminders = ENV_ONLY.map((entry) => ({
    provider: entry.provider,
    status: "env-only",
    notes: entry.notes,
  }));

  console.log("Review CLI flag drift check — see docs/archive/review-cli-flags.md for rationale.\n");

  console.log("CLI flag probes:");
  for (const row of results) {
    console.log(`  ${formatRow(row)}`);
  }

  console.log("\nEnv-var-based constraints (manual watch only):");
  for (const row of envReminders) {
    console.log(`  [ env    ] ${row.provider}`);
    console.log(`             ${row.notes}`);
  }

  const drifted = results.filter((r) => r.status === "drift");
  const skipped = results.filter((r) => r.status === "skipped");

  console.log("");
  if (drifted.length > 0) {
    console.log(`Drift detected in ${drifted.length} CLI${drifted.length === 1 ? "" : "s"}. Review docs/archive/review-cli-flags.md and the provider's review hard-constraint block in plugins/polycli/scripts/lib/review.mjs.`);
    process.exit(2);
  }
  if (skipped.length > 0) {
    console.log(`${skipped.length} CLI${skipped.length === 1 ? "" : "s"} skipped (not installed locally). Re-run on a machine with all provider CLIs before shipping a release that touches /review.`);
  }
  console.log("No CLI drift detected against the locked flag set.");
  process.exit(0);
}

main();
