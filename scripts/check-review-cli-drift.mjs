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
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { REVIEW_FLAG_EXPECTATIONS } from "@bbingz/polycli-runtime";

// LOCAL regex-anchor sanity check (Q8c rev2, Codex S7).
//
// This guards ONLY against a polycli-side refactor silently dropping the
// exact phrase the auth classifier regex depends on. It reads the regex
// SOURCE from the runtime module and confirms the anchor substring is still
// present. It does NOT — and cannot — detect that an upstream CLI changed
// its auth-error wording; that real upstream auth-wording probe stays an
// open Q8c follow-up (there is no safe way to force an unauth CLI state
// inside this check).
const RUNTIME_SRC = path.resolve(import.meta.dirname, "..", "packages", "polycli-runtime", "src");
const AUTH_ANCHORS = [
  {
    provider: "gemini",
    file: path.join(RUNTIME_SRC, "gemini.js"),
    regexName: "GEMINI_EXPLICIT_AUTH_ERROR_RE",
    // Substring the explicit-auth-error regex relies on; if a refactor drops
    // it, the auth classifier silently stops matching this phrase.
    anchor: "invalid api key",
  },
  {
    provider: "kimi",
    file: path.join(RUNTIME_SRC, "kimi.js"),
    regexName: "KIMI_EXPLICIT_AUTH_ERROR_RE",
    anchor: "invalid api key",
  },
];

// Extract the regex literal SOURCE for `regexName` from a module's source
// text, so the anchor is verified against the live regex (never hardcoded
// twice). Returns the regex literal as a string, or null if not found.
export function extractRegexSource(moduleSource, regexName) {
  // Match: const NAME = /.../flags; (regex body has no unescaped newline).
  const re = new RegExp(`${regexName}\\s*=\\s*(/(?:\\\\.|[^/\\n])+/[a-z]*)`);
  const match = re.exec(String(moduleSource ?? ""));
  return match ? match[1] : null;
}

// Pure check over an explicit set of anchors with an injectable source reader,
// so tests can feed a regex source that is MISSING the anchor phrase.
export function checkAuthAnchors(anchors = AUTH_ANCHORS, { readFileFn = (p) => fs.readFileSync(p, "utf8") } = {}) {
  return anchors.map((entry) => {
    let source;
    try {
      source = readFileFn(entry.file);
    } catch (error) {
      return { provider: entry.provider, status: "skipped", reason: error.message };
    }
    const regexSource = extractRegexSource(source, entry.regexName);
    if (regexSource === null) {
      return { provider: entry.provider, status: "missing-regex", regexName: entry.regexName };
    }
    const present = regexSource.toLowerCase().includes(entry.anchor.toLowerCase());
    return {
      provider: entry.provider,
      status: present ? "ok" : "anchor-missing",
      anchor: entry.anchor,
      regexName: entry.regexName,
    };
  });
}

// expect/forbid/probes are sourced from the shared REVIEW_FLAG_EXPECTATIONS map
// (single source of truth, mirrored against lib/review.mjs by the consistency
// test). bin/helpArgs/notes stay inline because they are machine-specific.
const CHECKS = [
  {
    provider: "claude",
    bin: "claude",
    helpArgs: ["--help"],
    expect: REVIEW_FLAG_EXPECTATIONS.claude.expectFlags,
    notes: "Prompt/review hard constraints use --tools \"\" and an empty strict MCP config to deny model-visible tools and MCP servers.",
  },
  {
    provider: "gemini",
    bin: "gemini",
    helpArgs: ["--help"],
    expect: REVIEW_FLAG_EXPECTATIONS.gemini.expectFlags,
    notes: "Review hard constraint writes a Policy Engine TOML and passes --policy <file>; --approval-mode plan is the read-only mode.",
  },
  {
    provider: "qwen",
    bin: "qwen",
    helpArgs: ["--help"],
    expect: REVIEW_FLAG_EXPECTATIONS.qwen.expectFlags,
    notes: "Prompt/review constraints use approval-mode plan and exclude-tools; ask is bounded at --max-session-turns 20 instead of the broken one-turn cap.",
  },
  {
    provider: "copilot",
    bin: "copilot",
    helpArgs: ["--help"],
    expect: REVIEW_FLAG_EXPECTATIONS.copilot.expectFlags,
    notes: "Review/prompt constraints keep programmatic --no-ask-user but drop allow-all tool/path/url flags and use --excluded-tools <list>.",
  },
  {
    provider: "opencode",
    bin: "opencode",
    helpArgs: ["--help"],
    expect: REVIEW_FLAG_EXPECTATIONS.opencode.expectFlags,
    notes: "Review hard constraint uses --agent plan plus injected OPENCODE_CONFIG_CONTENT env var with permission: \"deny\" (env path cannot be --help-verified).",
  },
  {
    provider: "pi",
    bin: "pi",
    helpArgs: ["--help"],
    expect: REVIEW_FLAG_EXPECTATIONS.pi.expectFlags,
    notes: "Prompt/review hard constraints use stateless no-tool/no-context flags.",
  },
  {
    provider: "cmd",
    bin: "cmd",
    helpArgs: ["--help"],
    expect: REVIEW_FLAG_EXPECTATIONS.cmd.expectFlags,
    notes: "Review hard constraint uses --permission-mode plan.",
  },
  {
    provider: "agy",
    bin: process.env.AGY_CLI_BIN || "agy",
    helpArgs: ["--help"],
    expect: REVIEW_FLAG_EXPECTATIONS.agy.expectFlags,
    // agy is review-unsupported because it has NO plan/approval flag. An empty
    // `expect` can only catch flags disappearing, so we also `forbid` the
    // plan-mode flags other providers use: if any appears, agy may now support
    // a read-only mode and /review support should be re-evaluated.
    forbid: REVIEW_FLAG_EXPECTATIONS.agy.forbidFlags,
    notes: "agy has no plan-mode flag; /review is unsupported. If a forbidden plan/approval flag appears, re-evaluate enabling /review for agy.",
  },
  {
    provider: "minimax",
    bin: process.env.MMX_CLI_BIN || process.env.MINIMAX_CLI_BIN || "mmx",
    probes: REVIEW_FLAG_EXPECTATIONS.minimax.probes,
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

function formatAnchorRow(row) {
  switch (row.status) {
    case "ok":
      return `[ regex-anchor ] ${row.provider} — ok (${row.regexName} still contains "${row.anchor}")`;
    case "anchor-missing":
      return `[ regex-anchor ] ${row.provider} — ANCHOR MISSING: ${row.regexName} no longer contains "${row.anchor}"`;
    case "missing-regex":
      return `[ regex-anchor ] ${row.provider} — REGEX NOT FOUND: ${row.regexName}`;
    case "skipped":
      return `[ regex-anchor ] ${row.provider} — skip — ${row.reason}`;
    default:
      return `[ regex-anchor ] ${row.provider} — ??`;
  }
}

function main(argv = process.argv.slice(2)) {
  const strict = argv.includes("--strict");
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

  const anchorResults = checkAuthAnchors();
  console.log("\nLocal regex-anchor sanity check (LOCAL ONLY — does NOT detect upstream CLI wording changes):");
  for (const row of anchorResults) {
    console.log(`  ${formatAnchorRow(row)}`);
  }
  console.log("  note: this only catches a polycli-side refactor dropping the anchor phrase.");
  console.log("  note: a real upstream auth-wording probe (observing an unauthenticated CLI response) is an open Q8c follow-up, not solved here.");

  const drifted = results.filter((r) => r.status === "drift");
  const skipped = results.filter((r) => r.status === "skipped");
  const anchorBroken = anchorResults.filter((r) => r.status === "anchor-missing" || r.status === "missing-regex");

  console.log("");
  if (drifted.length > 0) {
    console.log(`Drift detected in ${drifted.length} CLI${drifted.length === 1 ? "" : "s"}. Review docs/archive/review-cli-flags.md and the provider's review hard-constraint block in plugins/polycli/scripts/lib/review.mjs.`);
    process.exit(2);
  }
  if (anchorBroken.length > 0) {
    const detail = anchorBroken.map((r) => r.provider).join(", ");
    if (strict) {
      console.log(`Regex-anchor sanity check failed for: ${detail}. A polycli-side refactor dropped an auth-classifier anchor phrase. (--strict)`);
      process.exit(2);
    }
    console.log(`Regex-anchor sanity check found ${anchorBroken.length} issue(s) for: ${detail} (advisory; pass --strict to make this fail the build).`);
  }
  if (skipped.length > 0) {
    console.log(`${skipped.length} CLI${skipped.length === 1 ? "" : "s"} skipped (not installed locally). Re-run on a machine with all provider CLIs before shipping a release that touches /review.`);
  }
  console.log("No CLI drift detected against the locked flag set.");
  process.exit(0);
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
