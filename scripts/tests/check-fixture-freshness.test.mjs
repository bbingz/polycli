import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractVersionToken,
  compareFixtureVersion,
  checkFixtureFreshness,
  PROVIDER_VERSION_PROBES,
} from "../check-fixture-freshness.mjs";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "polycli-freshness-test-"));
}

function writeMeta(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("extractVersionToken parses a bare semver", () => {
  assert.equal(extractVersionToken("0.17.0"), "0.17.0");
});

test("extractVersionToken parses claude's parenthetical output", () => {
  assert.equal(extractVersionToken("2.1.147 (Claude Code)"), "2.1.147");
});

test("extractVersionToken parses gemini's prefixed output", () => {
  assert.equal(extractVersionToken("gemini version 0.43.1"), "0.43.1");
});

test("extractVersionToken parses copilot's noisy multi-line output", () => {
  assert.equal(
    extractVersionToken("GitHub Copilot CLI 1.0.34.\nRun 'copilot update' to check for updates."),
    "1.0.34",
  );
});

test("extractVersionToken parses kimi's comma-separated output", () => {
  assert.equal(extractVersionToken("kimi, version 1.37.0"), "1.37.0");
});

test("extractVersionToken returns null when no semver token is present", () => {
  assert.equal(extractVersionToken("no version here"), null);
  assert.equal(extractVersionToken(""), null);
  assert.equal(extractVersionToken(null), null);
});

test("compareFixtureVersion reports ok when semver tokens match", () => {
  assert.deepEqual(
    compareFixtureVersion({ pinned: "kimi, version 1.37.0", installed: "1.37.0" }),
    { status: "ok", pinned: "1.37.0", installed: "1.37.0" },
  );
});

test("compareFixtureVersion reports stale when semver tokens differ", () => {
  assert.deepEqual(
    compareFixtureVersion({ pinned: "0.38.2", installed: "gemini version 0.43.1" }),
    { status: "stale", pinned: "0.38.2", installed: "0.43.1" },
  );
});

test("compareFixtureVersion reports unknown when a token cannot be parsed", () => {
  assert.equal(
    compareFixtureVersion({ pinned: "mini-agent", installed: "0.1.0" }).status,
    "unknown",
  );
});

test("checkFixtureFreshness classifies stale / ok / absent via injected spawn", () => {
  const root = makeTempRoot();
  writeMeta(root, "gemini/stream-success.meta.json", {
    provider: "gemini",
    name: "stream-success",
    capturedAt: "2026-04-22T12:44:18.282Z",
    version: "0.38.2",
    argv: ["prompt"],
    expected: { response: "HELLO" },
  });
  writeMeta(root, "kimi/stream-success.meta.json", {
    provider: "kimi",
    name: "stream-success",
    capturedAt: "2026-04-22T12:44:18.282Z",
    version: "kimi, version 1.37.0",
    argv: ["prompt"],
    expected: { response: "HELLO" },
  });
  writeMeta(root, "pi/stream-success.meta.json", {
    provider: "pi",
    name: "stream-success",
    capturedAt: "2026-04-22T12:44:18.282Z",
    version: "0.68.1",
    argv: ["prompt"],
    expected: { response: "HELLO" },
  });

  const fakeSpawn = (bin) => {
    if (bin === "gemini") return { stdout: "0.43.1", stderr: "" }; // stale
    if (bin === "kimi") return { stdout: "kimi, version 1.37.0\n", stderr: "" }; // ok
    // pi: not installed
    return { error: Object.assign(new Error("spawn pi ENOENT"), { code: "ENOENT" }) };
  };

  const report = checkFixtureFreshness({ fixtureRoot: root, spawnFn: fakeSpawn });

  const byProvider = Object.fromEntries(report.rows.map((r) => [r.provider, r]));
  assert.equal(byProvider.gemini.status, "stale");
  assert.equal(byProvider.gemini.pinned, "0.38.2");
  assert.equal(byProvider.gemini.installed, "0.43.1");
  assert.equal(byProvider.kimi.status, "ok");
  assert.equal(byProvider.pi.status, "skipped");
  assert.equal(report.stale.length, 1);
  assert.equal(report.skipped.length, 1);
});

test("checkFixtureFreshness skips (not fails) when spawn errors non-ENOENT", () => {
  const root = makeTempRoot();
  writeMeta(root, "qwen/stream-success.meta.json", {
    provider: "qwen",
    name: "stream-success",
    capturedAt: "2026-04-22T12:44:18.282Z",
    version: "0.14.5",
    argv: ["prompt"],
    expected: { response: "HELLO" },
  });

  const fakeSpawn = () => ({ error: new Error("timed out") });
  const report = checkFixtureFreshness({ fixtureRoot: root, spawnFn: fakeSpawn });
  assert.equal(report.rows[0].status, "skipped");
  assert.equal(report.stale.length, 0);
});

test("PROVIDER_VERSION_PROBES covers every runtime provider with a version arg", () => {
  const providers = ["claude", "gemini", "qwen", "copilot", "opencode", "pi", "kimi", "minimax", "cmd", "agy", "grok"];
  for (const provider of providers) {
    const probe = PROVIDER_VERSION_PROBES[provider];
    assert.ok(probe, `missing probe for ${provider}`);
    assert.ok(typeof probe.bin === "string" && probe.bin.length > 0, `${provider} bin`);
    assert.ok(Array.isArray(probe.versionArgs) && probe.versionArgs.length > 0, `${provider} versionArgs`);
  }
  // gemini uses -v, not --version (upstream contract).
  assert.deepEqual(PROVIDER_VERSION_PROBES.gemini.versionArgs, ["-v"]);
  // kimi uses -V (capital), not -v.
  assert.deepEqual(PROVIDER_VERSION_PROBES.kimi.versionArgs, ["-V"]);
});
