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
    expect: ["--tools", "--mcp-config", "--strict-mcp-config"],
    notes: "Prompt/review hard constraints use --tools \"\" and an empty strict MCP config to deny model-visible tools and MCP servers.",
  },
  {
    provider: "gemini",
    bin: "gemini",
    helpArgs: ["--help"],
    expect: ["--approval-mode", "--policy"],
    notes: "Review hard constraint writes a Policy Engine TOML and passes --policy <file>; --approval-mode plan is the read-only mode.",
  },
  {
    provider: "qwen",
    bin: "qwen",
    helpArgs: ["--help"],
    expect: ["--approval-mode", "--exclude-tools", "--max-session-turns"],
    notes: "Prompt/review constraints use approval-mode plan and exclude-tools; ask is bounded at --max-session-turns 20 instead of the broken one-turn cap.",
  },
  {
    provider: "copilot",
    bin: "copilot",
    helpArgs: ["--help"],
    expect: ["--excluded-tools", "--allow-all-tools", "--allow-all-paths", "--allow-all-urls", "--no-ask-user"],
    notes: "Review/prompt constraints keep programmatic --no-ask-user but drop allow-all tool/path/url flags and use --excluded-tools <list>.",
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
    expect: ["--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files"],
    notes: "Prompt/review hard constraints use stateless no-tool/no-context flags.",
  },
  {
    provider: "cmd",
    bin: "cmd",
    helpArgs: ["--help"],
    expect: ["--permission-mode"],
    notes: "Review hard constraint uses --permission-mode plan.",
  },
  {
    provider: "agy",
    bin: process.env.AGY_CLI_BIN || "agy",
    helpArgs: ["--help"],
    expect: [],
    // agy is review-unsupported because it has NO plan/approval flag. An empty
    // `expect` can only catch flags disappearing, so we also `forbid` the
    // plan-mode flags other providers use: if any appears, agy may now support
    // a read-only mode and /review support should be re-evaluated.
    forbid: ["--approval-mode", "--permission-mode", "--policy", "--plan", "--agent"],
    notes: "agy has no plan-mode flag; /review is unsupported. If a forbidden plan/approval flag appears, re-evaluate enabling /review for agy.",
  },
  {
    provider: "minimax",
    bin: process.env.MMX_CLI_BIN || process.env.MINIMAX_CLI_BIN || "mmx",
    probes: [
      { helpArgs: ["text", "chat", "--help"], expect: ["--message"] },
      { helpArgs: ["--help"], expect: ["--output", "--non-interactive"] },
    ],
    notes: "MiniMax provider uses official mmx-cli text chat in non-interactive JSON mode, not mini-agent log scraping.",
  },
];

const ENV_ONLY = [
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
  const { provider, expect, forbid = [], notes } = entry;
  const probes = entry.probes ?? [{ helpArgs: entry.helpArgs, expect }];
  const missing = [];
  let lastText = "";
  for (const probeEntry of probes) {
    const result = probe({ ...entry, helpArgs: probeEntry.helpArgs });
    if (result.skipped) {
      return { provider, status: "skipped", reason: result.reason, notes };
    }
    lastText = result.text;
    missing.push(...probeEntry.expect.filter((flag) => !result.text.includes(flag)));
  }
  const appeared = forbid.filter((flag) => lastText.includes(flag));
  if (missing.length === 0 && appeared.length === 0) {
    return { provider, status: "ok" };
  }
  return { provider, status: "drift", missing, appeared, notes };
}

function formatRow({ provider, status, reason, missing, appeared, notes }) {
  switch (status) {
    case "ok":
      return `[ ok     ] ${provider}`;
    case "skipped":
      return `[ skip   ] ${provider} — ${reason}`;
    case "drift": {
      const parts = [];
      if (missing?.length) parts.push(`missing: ${missing.join(", ")}`);
      if (appeared?.length) parts.push(`unexpected: ${appeared.join(", ")}`);
      return [
        `[ DRIFT  ] ${provider} — ${parts.join("; ")}`,
        `           ${notes}`,
      ].join("\n");
    }
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
