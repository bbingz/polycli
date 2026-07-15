import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  extractMiniMaxResponseFromMmxJson,
  parseClaudeStreamText,
  parseCopilotStreamText,
  parseGeminiStreamText,
  parseGrokStreamText,
  parseKimiStreamText,
  parseOpenCodeStreamText,
  parsePiStreamText,
  parseQwenStreamText,
} from "../src/index.js";
import { listStreamFixtures, loadStreamFixture } from "./helpers/fixture-replay.mjs";
import { validateFixtureMetadata } from "../../../scripts/validate-fixture-metadata.mjs";

const PARSERS = {
  claude: (fixture) => parseClaudeStreamText(fixture.stream),
  copilot: (fixture) => parseCopilotStreamText(fixture.stream),
  gemini: (fixture) => parseGeminiStreamText(fixture.stream),
  grok: (fixture) => parseGrokStreamText(fixture.stream),
  kimi: (fixture) => parseKimiStreamText(fixture.stream),
  opencode: (fixture) => parseOpenCodeStreamText(fixture.stream),
  opencode2: (fixture) => parseOpenCodeStreamText(fixture.stream),
  pi: (fixture) => parsePiStreamText(fixture.stream),
  qwen: (fixture) => parseQwenStreamText(fixture.stream),
};

test("MiniMax metadata requires the complete mmx replay expectation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-minimax-fixture-"));
  const relativeBase = "minimax/run-success";
  fs.mkdirSync(path.join(root, "minimax"), { recursive: true });
  fs.writeFileSync(path.join(root, `${relativeBase}.stream.txt`), "{}\n", "utf8");

  const baseMeta = {
    provider: "minimax",
    name: "run-success",
    capturedAt: "2026-07-14T20:01:18.665Z",
    version: "mmx 1.0.16",
    argv: ["text", "chat", "--output", "json"],
    expected: { response: "HELLO_MINIMAX_FIXTURE", finishReason: "end_turn", toolCalls: [] },
  };

  for (const [missingField, message] of [
    ["response", /expected\.response must be a non-empty string/],
    ["finishReason", /expected\.finishReason must be a non-empty string/],
    ["toolCalls", /expected\.toolCalls must be an array/],
  ]) {
    const meta = structuredClone(baseMeta);
    delete meta.expected[missingField];
    fs.writeFileSync(path.join(root, `${relativeBase}.meta.json`), `${JSON.stringify(meta)}\n`, "utf8");
    assert.throws(
      () => validateFixtureMetadata({ fixtureRoot: root, requiredSuccessProviders: ["minimax"] }),
      message,
      `MiniMax metadata without expected.${missingField} must be rejected`,
    );
  }
});

test("all captured runtime fixtures replay through their provider parser", () => {
  const fixtures = listStreamFixtures();
  assert.ok(fixtures.length > 0, "expected runtime fixtures");

  for (const fixtureRef of fixtures) {
    const fixture = loadStreamFixture(fixtureRef.provider, fixtureRef.name);
    if (fixtureRef.provider === "minimax") {
      const parsed = extractMiniMaxResponseFromMmxJson(fixture.stream);
      assert.deepEqual(
        {
          response: parsed.response,
          finishReason: parsed.finishReason,
          toolCalls: parsed.toolCalls,
        },
        fixture.meta.expected,
        `${fixtureRef.provider}/${fixtureRef.name} should replay`,
      );
      continue;
    }

    const parser = PARSERS[fixtureRef.provider];
    assert.equal(typeof parser, "function", `${fixtureRef.provider} must have a fixture parser`);
    const parsed = parser(fixture);
    assert.equal(
      parsed.response,
      fixture.meta.expected.response,
      `${fixtureRef.provider}/${fixtureRef.name} response should replay`,
    );
    if (fixture.meta.expected.sessionId != null) {
      assert.equal(
        parsed.sessionId,
        fixture.meta.expected.sessionId,
        `${fixtureRef.provider}/${fixtureRef.name} sessionId should replay`,
      );
    }
  }
});
