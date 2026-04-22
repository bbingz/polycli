export const UUID_SESSION_ID_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export function matchSessionId(text, { patterns = [UUID_SESSION_ID_REGEX] } = {}) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }

  for (const pattern of patterns) {
    const flags = pattern.flags.replace(/g/g, "");
    const regex = new RegExp(pattern.source, flags);
    const match = text.match(regex);
    if (match) {
      return match[0];
    }
  }

  return null;
}

export function resolveSessionId({
  stdout = "",
  stderr = "",
  fileValue = null,
  patterns,
  priority = ["stdout", "stderr", "file"],
} = {}) {
  const sources = {
    stdout,
    stderr,
    file: typeof fileValue === "string" ? fileValue : "",
  };

  for (const source of priority) {
    const sessionId = matchSessionId(sources[source], { patterns });
    if (sessionId) {
      return { sessionId, source };
    }
  }

  return { sessionId: null, source: null };
}
