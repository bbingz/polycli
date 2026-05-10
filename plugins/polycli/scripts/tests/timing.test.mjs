import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateTimingRecord } from "@bbingz/polycli-timing";

import {
  appendTimingRecord,
  describeTimingStore,
  listTimingRecords,
  resolveTimingHistoryFile,
  summarizeTimingRecords,
} from "../lib/timing.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.resolve(HERE, "../polycli-companion.mjs");

function withPluginData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-timing-test-"));
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

function makeRecord(provider, totalMs, completedAt) {
  return {
    version: 1,
    provider,
    runtimePersistence: "ephemeral",
    measurementScope: "request",
    completedAt,
    kind: "ask",
    metrics: {
      cold: { status: "unsupported", ms: null },
      ttft: { status: "missing", ms: null },
      gen: { status: "missing", ms: null },
      tool: { status: "unsupported", ms: null },
      retry: { status: "unsupported", ms: null },
      tail: { status: "unsupported", ms: null },
      total: { status: "measured", ms: totalMs },
    },
  };
}

test("appendTimingRecord persists validated NDJSON history", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-timing";
    const record = makeRecord("qwen", 1234, "2026-04-22T00:00:00.000Z");
    assert.equal(validateTimingRecord(record).ok, true);

    appendTimingRecord(workspaceRoot, record);

    const file = resolveTimingHistoryFile(workspaceRoot);
    assert.ok(fs.existsSync(file));
    const saved = listTimingRecords(workspaceRoot);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].metrics.total.ms, 1234);
  });
});

test("POLYCLI_STATE_ROOT takes precedence over CLAUDE_PLUGIN_DATA for timing history", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-state-root-"));
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const previousStateRoot = process.env.POLYCLI_STATE_ROOT;
  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.POLYCLI_STATE_ROOT = stateRoot;
  process.env.CLAUDE_PLUGIN_DATA = pluginData;

  try {
    const workspaceRoot = "/tmp/polycli-state-root-test";
    const file = resolveTimingHistoryFile(workspaceRoot);
    const store = describeTimingStore(workspaceRoot);

    assert.equal(file.startsWith(stateRoot), true);
    assert.equal(store.stateRoot, stateRoot);
    assert.equal(store.stateRootSource, "POLYCLI_STATE_ROOT");
    assert.equal(store.stateDir.startsWith(stateRoot), true);
    assert.equal(store.workspaceSlug.startsWith("polycli-state-root-test-"), true);
  } finally {
    if (previousStateRoot == null) delete process.env.POLYCLI_STATE_ROOT;
    else process.env.POLYCLI_STATE_ROOT = previousStateRoot;
    if (previousPluginData == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("summarizeTimingRecords aggregates by provider", () => {
  withPluginData(() => {
    const workspaceRoot = "/tmp/polycli-timing-summary";
    appendTimingRecord(workspaceRoot, makeRecord("qwen", 1000, "2026-04-22T00:00:00.000Z"));
    appendTimingRecord(workspaceRoot, makeRecord("qwen", 1500, "2026-04-22T00:00:01.000Z"));
    appendTimingRecord(workspaceRoot, makeRecord("kimi", 2000, "2026-04-22T00:00:02.000Z"));

    const records = listTimingRecords(workspaceRoot);
    const summary = summarizeTimingRecords(records);

    assert.equal(summary.recordCount, 3);
    assert.equal(summary.byProvider.qwen.recordCount, 2);
    assert.equal(summary.byProvider.qwen.metrics.total.p50, 1000);
    assert.equal(summary.byProvider.kimi.metrics.total.p50, 2000);
  });
});

test("timing --all --json returns full history and store metadata", () => {
  const workspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-timing-cli-")));
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-state-root-"));
  const previousStateRoot = process.env.POLYCLI_STATE_ROOT;
  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.POLYCLI_STATE_ROOT = stateRoot;
  delete process.env.CLAUDE_PLUGIN_DATA;

  try {
    for (let index = 0; index < 25; index += 1) {
      appendTimingRecord(
        workspaceRoot,
        makeRecord("qwen", 1000 + index, `2026-04-22T00:00:${String(index).padStart(2, "0")}.000Z`)
      );
    }

    const stdout = execFileSync(process.execPath, [COMPANION, "timing", "--all", "--json"], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        POLYCLI_STATE_ROOT: stateRoot,
      },
      encoding: "utf8",
    });
    const payload = JSON.parse(stdout);

    assert.equal(payload.records.length, 25);
    assert.equal(payload.metadata.historyLimit, "all");
    assert.equal(payload.metadata.aggregateScope, "records");
    assert.equal(payload.metadata.recordCount, 25);
    assert.equal(payload.metadata.stateRoot, stateRoot);
    assert.equal(payload.metadata.stateRootSource, "POLYCLI_STATE_ROOT");
    assert.equal(payload.metadata.workspaceRoot, workspaceRoot);
    assert.equal(payload.metadata.workspaceSlug.startsWith("polycli-timing-cli-"), true);
  } finally {
    if (previousStateRoot == null) delete process.env.POLYCLI_STATE_ROOT;
    else process.env.POLYCLI_STATE_ROOT = previousStateRoot;
    if (previousPluginData == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});
