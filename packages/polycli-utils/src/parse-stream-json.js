export function parseStreamJsonLine(raw, { allowPrefix = true } = {}) {
  const text = String(raw ?? "");
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, kind: "blank", raw: text };
  }

  let jsonCandidate = trimmed;
  let prefix = "";

  if (allowPrefix) {
    const jsonStart = text.indexOf("{");
    if (jsonStart < 0) {
      return { ok: false, kind: "blank", raw: text };
    }
    prefix = text.slice(0, jsonStart);
    jsonCandidate = text.slice(jsonStart).trim();
  } else if (!trimmed.startsWith("{")) {
    return { ok: false, kind: "blank", raw: text };
  }

  try {
    return {
      ok: true,
      raw: text,
      prefix,
      json: jsonCandidate,
      event: JSON.parse(jsonCandidate),
    };
  } catch (error) {
    return {
      ok: false,
      kind: "parse_error",
      raw: text,
      prefix,
      json: jsonCandidate,
      error: error.message,
    };
  }
}

export function parseStreamJsonText(text, options = {}) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => parseStreamJsonLine(line, options));
}
