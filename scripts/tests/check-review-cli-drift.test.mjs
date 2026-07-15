import assert from "node:assert/strict";
import test from "node:test";

import {
  checkCliFlags,
  extractRegexSource,
  checkAuthAnchors,
} from "../check-review-cli-drift.mjs";
import { RELEASE_STEPS } from "../check-release.mjs";

// A regex source line shaped like the real runtime modules.
const GEMINI_LIKE = `
const GEMINI_EXPLICIT_AUTH_ERROR_RE = /\\b(unauthenticated|invalid api key|forbidden|401|403)\\b/i;
const OTHER = /something else/;
`;

const GEMINI_LIKE_MISSING_ANCHOR = `
const GEMINI_EXPLICIT_AUTH_ERROR_RE = /\\b(unauthenticated|forbidden|401|403)\\b/i;
`;

test("extractRegexSource pulls the named regex literal from module source", () => {
  const src = extractRegexSource(GEMINI_LIKE, "GEMINI_EXPLICIT_AUTH_ERROR_RE");
  assert.ok(src);
  assert.ok(src.startsWith("/"));
  assert.ok(src.includes("invalid api key"));
  // does not bleed into the next const declaration
  assert.ok(!src.includes("something else"));
});

test("extractRegexSource returns null when the regex name is absent", () => {
  assert.equal(extractRegexSource(GEMINI_LIKE, "NOPE_RE"), null);
  assert.equal(extractRegexSource("", "GEMINI_EXPLICIT_AUTH_ERROR_RE"), null);
});

test("checkAuthAnchors reports ok when the anchor is present in the regex source", () => {
  const anchors = [
    {
      provider: "gemini",
      file: "/fake/gemini.js",
      regexName: "GEMINI_EXPLICIT_AUTH_ERROR_RE",
      anchor: "invalid api key",
    },
  ];
  const rows = checkAuthAnchors(anchors, { readFileFn: () => GEMINI_LIKE });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].provider, "gemini");
});

test("checkAuthAnchors reports anchor-missing when the injected source drops the phrase", () => {
  const anchors = [
    {
      provider: "gemini",
      file: "/fake/gemini.js",
      regexName: "GEMINI_EXPLICIT_AUTH_ERROR_RE",
      anchor: "invalid api key",
    },
  ];
  const rows = checkAuthAnchors(anchors, { readFileFn: () => GEMINI_LIKE_MISSING_ANCHOR });
  assert.equal(rows[0].status, "anchor-missing");
  assert.equal(rows[0].anchor, "invalid api key");
});

test("checkAuthAnchors reports missing-regex when the regex declaration is gone", () => {
  const anchors = [
    {
      provider: "kimi",
      file: "/fake/kimi.js",
      regexName: "KIMI_EXPLICIT_AUTH_ERROR_RE",
      anchor: "invalid api key",
    },
  ];
  const rows = checkAuthAnchors(anchors, { readFileFn: () => "const X = 1;" });
  assert.equal(rows[0].status, "missing-regex");
});

test("checkAuthAnchors skips (not fails) when the source file cannot be read", () => {
  const anchors = [
    {
      provider: "gemini",
      file: "/does/not/exist.js",
      regexName: "GEMINI_EXPLICIT_AUTH_ERROR_RE",
      anchor: "invalid api key",
    },
  ];
  const rows = checkAuthAnchors(anchors, {
    readFileFn: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(rows[0].status, "skipped");
});

test("checkAuthAnchors against the REAL runtime source confirms current regexes hold the anchor", () => {
  const rows = checkAuthAnchors();
  const byProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));
  assert.equal(byProvider.gemini.status, "ok");
  assert.equal(byProvider.kimi.status, "ok");
});

test("checkCliFlags supports contextual help probes for Qwen's minimal bare help", () => {
  const calls = [];
  const entry = {
    provider: "qwen",
    notes: "contextual help",
    probes: [
      {
        helpArgs: ["--approval-mode", "plan", "--help"],
        expect: ["--exclude-tools", "--max-session-turns"],
      },
      {
        helpArgs: ["--max-session-turns", "1", "--help"],
        expect: ["--approval-mode"],
      },
    ],
  };

  const result = checkCliFlags(entry, {
    probeFn({ helpArgs }) {
      calls.push(helpArgs);
      if (helpArgs[0] === "--approval-mode") {
        return { text: "--exclude-tools\n--max-session-turns" };
      }
      return { text: "--approval-mode" };
    },
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(calls, entry.probes.map((probe) => probe.helpArgs));
});

test("checkCliFlags identifies a missing option from a contextual help probe", () => {
  const result = checkCliFlags(
    {
      provider: "qwen",
      notes: "contextual help",
      probes: [{ helpArgs: ["--approval-mode", "plan", "--help"], expect: ["--exclude-tools"] }],
    },
    { probeFn: () => ({ text: "--max-session-turns" }) }
  );

  assert.equal(result.status, "drift");
  assert.deepEqual(result.missing, ["--exclude-tools"]);
});

test("RELEASE_STEPS wires check:review-drift after the deterministic validators", () => {
  const npmRunScripts = RELEASE_STEPS
    .filter(([cmd, args]) => cmd === "npm" && args[0] === "run")
    .map(([, args]) => args[1]);
  assert.ok(npmRunScripts.includes("check:review-drift"), "release gate must invoke check:review-drift");

  // It must run AFTER the deterministic validate:* steps (so a CLI-less
  // contributor passes those first) and BEFORE the claude plugin validate
  // steps stay last in the list.
  const driftIdx = RELEASE_STEPS.findIndex(([cmd, args]) => cmd === "npm" && args[1] === "check:review-drift");
  const lastValidateIdx = RELEASE_STEPS.reduce(
    (acc, [cmd, args], i) => (cmd === "npm" && typeof args[1] === "string" && args[1].startsWith("validate:") ? i : acc),
    -1,
  );
  assert.ok(lastValidateIdx >= 0, "expected at least one validate:* step");
  assert.ok(driftIdx > lastValidateIdx, "check:review-drift must run after the validate:* steps");
});

test("RELEASE_STEPS requires strict fixture freshness before publishing checks", () => {
  const freshnessIdx = RELEASE_STEPS.findIndex(
    ([cmd, args]) => cmd === "npm" && args[1] === "check:fixture-freshness" && args[2] === "--" && args[3] === "--strict",
  );
  const driftIdx = RELEASE_STEPS.findIndex(([cmd, args]) => cmd === "npm" && args[1] === "check:review-drift");
  assert.ok(freshnessIdx >= 0, "release gate must invoke check:fixture-freshness -- --strict");
  assert.ok(freshnessIdx < driftIdx, "strict fixture freshness must run before installed-CLI drift review");
});

test("RELEASE_STEPS validates source-derived bundles before npm test can rebuild them", () => {
  const freshnessIdx = RELEASE_STEPS.findIndex(
    ([cmd, args]) => cmd === "npm" && args[0] === "run" && args[1] === "validate:bundles",
  );
  const testIdx = RELEASE_STEPS.findIndex(
    ([cmd, args]) => cmd === "npm" && args[0] === "test",
  );

  assert.ok(freshnessIdx >= 0, "release gate must invoke validate:bundles");
  assert.ok(testIdx > freshnessIdx, "source-derived bundle freshness must be checked before npm test");
});
