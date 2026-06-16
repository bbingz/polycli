import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(HERE, "..", "fixtures");

export function loadStreamFixture(provider, name) {
  const base = path.join(FIXTURE_ROOT, provider, name);
  const stream = fs.readFileSync(`${base}.stream.txt`, "utf8");
  const meta = JSON.parse(fs.readFileSync(`${base}.meta.json`, "utf8"));
  const logPath = `${base}.log.txt`;
  const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : null;
  return { stream, logText, meta };
}

export function listStreamFixtures() {
  const fixtures = [];
  for (const provider of fs.readdirSync(FIXTURE_ROOT).sort()) {
    const providerDir = path.join(FIXTURE_ROOT, provider);
    if (!fs.statSync(providerDir).isDirectory()) continue;
    for (const entry of fs.readdirSync(providerDir).sort()) {
      if (!entry.endsWith(".meta.json")) continue;
      const name = entry.slice(0, -".meta.json".length);
      fixtures.push({ provider, name });
    }
  }
  return fixtures;
}
