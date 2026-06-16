import test from "node:test";
import assert from "node:assert/strict";

import {
  extractMiniMaxLogPath,
  extractMiniMaxResponseFromLogText,
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

const PARSERS = {
  claude: (fixture) => parseClaudeStreamText(fixture.stream),
  copilot: (fixture) => parseCopilotStreamText(fixture.stream),
  gemini: (fixture) => parseGeminiStreamText(fixture.stream),
  grok: (fixture) => parseGrokStreamText(fixture.stream),
  kimi: (fixture) => parseKimiStreamText(fixture.stream),
  opencode: (fixture) => parseOpenCodeStreamText(fixture.stream),
  pi: (fixture) => parsePiStreamText(fixture.stream),
  qwen: (fixture) => parseQwenStreamText(fixture.stream),
};

test("all captured runtime fixtures replay through their provider parser", () => {
  const fixtures = listStreamFixtures();
  assert.ok(fixtures.length > 0, "expected runtime fixtures");

  for (const fixtureRef of fixtures) {
    const fixture = loadStreamFixture(fixtureRef.provider, fixtureRef.name);
    if (fixtureRef.provider === "minimax") {
      assert.ok(extractMiniMaxLogPath(fixture.stream), `${fixtureRef.provider}/${fixtureRef.name} must include a log path`);
      assert.deepEqual(
        extractMiniMaxResponseFromLogText(fixture.logText),
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
