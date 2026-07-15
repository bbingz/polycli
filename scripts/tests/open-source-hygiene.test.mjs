import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const FORBIDDEN_PATTERNS = [
  {
    pattern: /\/Users\/bing/g,
    label: "local maintainer path",
  },
  {
    pattern: new RegExp(["redacted", "Encrypted", "Content"].join(""), "g"),
    label: "encrypted provider reasoning payload",
  },
  {
    pattern: new RegExp(["redacted", "Reasoning", "Signature"].join(""), "g"),
    label: "provider reasoning signature",
  },
  {
    pattern: new RegExp(`"${["redacted", "Memory", "Paths"].join("")}"`, "g"),
    label: "local memory path metadata",
  },
  {
    pattern: new RegExp(`"${["redacted", "Auth", "Source"].join("")}"`, "g"),
    label: "host auth source metadata",
  },
];

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    // In a dirty worktree, git ls-files still lists an intentionally deleted
    // tracked file until it is staged. Hygiene can only inspect files that are
    // present; a clean CI checkout retains the full tracked-file coverage.
    .filter((relativeFile) => fs.existsSync(path.join(REPO_ROOT, relativeFile)));
}

test("tracked public files do not expose maintainer-local metadata", () => {
  const findings = [];
  for (const relativeFile of trackedFiles()) {
    const text = fs.readFileSync(path.join(REPO_ROOT, relativeFile), "utf8");
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        findings.push(`${relativeFile}: ${label}`);
      }
    }
  }

  assert.deepEqual(findings, []);
});
