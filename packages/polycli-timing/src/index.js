import fs from "node:fs";

export * from "./constants.js";
export * from "./percentile.js";
export * from "./validate.js";
export * from "./aggregate.js";

export const TIMING_SCHEMA_URL = new URL("../timing.schema.json", import.meta.url);

export function readTimingSchema() {
  return JSON.parse(fs.readFileSync(TIMING_SCHEMA_URL, "utf8"));
}
