import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendPreview,
  previewText,
  resetPreviewTailCache,
} from "../lib/preview.mjs";

function fileMode(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

test("previewText slices by code point without splitting emoji", () => {
  assert.equal(previewText("A😀BCDE", 5), "A😀BC…");
});

test("appendPreview dedupes repeated blocks from an in-memory tail cache", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-preview-"));
  const logFile = path.join(root, "preview.log");
  let readCount = 0;
  const fsImpl = {
    appendFileSync(...args) {
      return fs.appendFileSync(...args);
    },
    readFileSync(...args) {
      readCount += 1;
      return fs.readFileSync(...args);
    },
  };

  resetPreviewTailCache();
  appendPreview(logFile, "gemini", { type: "message", role: "assistant", content: "same line" }, { fsImpl });
  appendPreview(logFile, "gemini", { type: "message", role: "assistant", content: "same line" }, { fsImpl });

  assert.equal(readCount, 0);
  assert.equal(fs.readFileSync(logFile, "utf8"), "same line\n");
});

test("appendPreview records agy text delta events", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-preview-"));
  const logFile = path.join(root, "preview.log");

  resetPreviewTailCache();
  appendPreview(logFile, "agy", { type: "text_delta", delta: "plain text" });

  assert.equal(fs.readFileSync(logFile, "utf8"), "plain text\n");
  assert.equal(fileMode(logFile), 0o600);
});

test("appendPreview tightens an existing log file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-preview-"));
  const logFile = path.join(root, "preview.log");
  fs.writeFileSync(logFile, "old\n", { encoding: "utf8", mode: 0o644 });

  resetPreviewTailCache();
  appendPreview(logFile, "agy", { type: "text_delta", delta: "new text" });

  assert.equal(fs.readFileSync(logFile, "utf8"), "old\nnew text\n");
  assert.equal(fileMode(logFile), 0o600);
});
