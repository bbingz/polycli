import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(HERE, "..", "fixtures");

export function loadStreamFixture(provider, name) {
  const base = path.join(FIXTURE_ROOT, provider, name);
  const streamPath = `${base}.stream.txt`;
  const metaPath = `${base}.meta.json`;
  if (!fs.existsSync(streamPath)) {
    throw new Error(`Missing stream fixture: ${streamPath}`);
  }
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Missing fixture metadata: ${metaPath}`);
  }
  const stream = fs.readFileSync(streamPath, "utf8");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  return { stream, meta, streamPath, metaPath };
}

export function createClaudeFixtureReplay(name, { lineDelayMs = 5 } = {}) {
  const fixture = loadStreamFixture("claude", name);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-claude-fixture-"));
  const bin = path.join(root, "claude");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const fixture = ${JSON.stringify({
  streamPath: fixture.streamPath,
  version: fixture.meta.version,
  expected: fixture.meta.expected,
  lineDelayMs,
})};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

if (args.includes("--version")) {
  process.stdout.write(fixture.version + "\\n");
  process.exit(0);
}

if (process.env.CLAUDE_ARGV_LOG) {
  fs.writeFileSync(process.env.CLAUDE_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}

const outputFormat = readArg("--output-format") || "text";
if (outputFormat === "json") {
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: fixture.expected.response,
    session_id: fixture.expected.sessionId,
    model: fixture.expected.model,
    duration_ms: fixture.lineDelayMs
  }) + "\\n");
  process.exit(0);
}

if (outputFormat !== "stream-json") {
  process.stderr.write("fixture replay only supports json and stream-json output\\n");
  process.exit(1);
}

(async () => {
  const text = fs.readFileSync(fixture.streamPath, "utf8");
  for (const line of text.split(/\\r?\\n/)) {
    if (!line) continue;
    process.stdout.write(line + "\\n");
    if (fixture.lineDelayMs > 0) await sleep(fixture.lineDelayMs);
  }
})().catch((error) => {
  process.stderr.write(error.stack || error.message || String(error));
  process.exit(1);
});
`,
    { mode: 0o755 }
  );

  return {
    ...fixture,
    root,
    bin,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
