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
