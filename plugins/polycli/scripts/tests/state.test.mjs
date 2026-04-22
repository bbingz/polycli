import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureStateDir,
  listJobs,
  readJobFile,
  resolveJobFile,
  resolveStateDir,
  resolveWorkspaceRoot,
  upsertJob,
  writeJobFile,
} from "../lib/state.mjs";

function withPluginData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-state-test-"));
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dir;
  try {
    return fn(dir);
  } finally {
    if (previous == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("resolveWorkspaceRoot falls back to cwd outside git", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-workspace-root-"));
  try {
    assert.equal(resolveWorkspaceRoot(temp), temp);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("resolveStateDir is stable for the same workspace", () => {
  withPluginData(() => {
    const first = resolveStateDir("/tmp/polycli-a");
    const second = resolveStateDir("/tmp/polycli-a");
    assert.equal(first, second);
  });
});

test("upsertJob stores jobs and writeJobFile persists envelopes", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-jobs";
    ensureStateDir(workspaceRoot);

    upsertJob(workspaceRoot, {
      jobId: "job-1",
      provider: "qwen",
      kind: "rescue",
      status: "running",
      promptPreview: "reply with pong",
    });

    const jobs = listJobs(workspaceRoot);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].jobId, "job-1");
    assert.equal(jobs[0].provider, "qwen");

    writeJobFile(workspaceRoot, "job-1", {
      job: { ...jobs[0], status: "completed" },
      result: { ok: true, response: "PONG" },
    });

    const envelope = readJobFile(resolveJobFile(workspaceRoot, "job-1"));
    assert.equal(envelope.job.status, "completed");
    assert.equal(envelope.result.response, "PONG");
  });
});
