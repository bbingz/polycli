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
