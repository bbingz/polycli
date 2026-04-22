export function calculatePercentiles(values, percentiles = [50, 95, 99]) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);

  const output = {};
  for (const percentile of percentiles) {
    const key = `p${percentile}`;
    if (sorted.length === 0) {
      output[key] = null;
      continue;
    }
    const rank = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
    output[key] = sorted[Math.min(rank, sorted.length - 1)];
  }
  return output;
}
