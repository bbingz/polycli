import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const CHECKED_PATHS = [
  "packages/polycli-runtime/test/fixtures",
  "plugins/polycli/scripts/tests/fixtures",
  "packages/polycli-utils/AGENTS.md",
  "packages/polycli-timing/AGENTS.md",
  "packages/polycli-runtime/AGENTS.md",
];

const FORBIDDEN_PATTERNS = [
  {
    pattern: /\/Users\/bing/g,
    label: "local maintainer path",
  },
  {
    pattern: /redactedEncryptedContent/g,
    label: "encrypted provider reasoning payload",
  },
  {
    pattern: /redactedReasoningSignature/g,
    label: "provider reasoning signature",
  },
  {
    pattern: /"redactedMemoryPaths"/g,
    label: "local memory path metadata",
  },
  {
    pattern: /"redactedAuthSource"/g,
    label: "host auth source metadata",
  },
];

function* walkFiles(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    yield relativePath;
    return;
  }

  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(child);
    } else if (entry.isFile()) {
      yield child;
    }
  }
}

test("public fixtures and package instructions do not expose maintainer-local metadata", () => {
  const findings = [];
  for (const checkedPath of CHECKED_PATHS) {
    for (const relativeFile of walkFiles(checkedPath)) {
      const text = fs.readFileSync(path.join(REPO_ROOT, relativeFile), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          findings.push(`${relativeFile}: ${label}`);
        }
      }
    }
  }

  assert.deepEqual(findings, []);
});
