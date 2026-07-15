export function formatProviderExitError(provider, status) {
  if (status === 124) {
    return `${provider} timed out`;
  }
  if (status === 130) {
    return `${provider} interrupted`;
  }
  if (status === 143) {
    return `${provider} terminated`;
  }
  return `${provider} exited with code ${status}`;
}

export function classifyProviderFailure(error, { provider = null } = {}) {
  const structuredCode = typeof error?.code === "string" ? error.code.toUpperCase() : null;
  if (structuredCode === "E2BIG") {
    return "argument_list_too_long";
  }
  if (structuredCode === "ENOENT") {
    return "binary_missing";
  }
  if (structuredCode === "ETIMEDOUT") {
    return "timeout";
  }
  const text = typeof error === "string"
    ? error
    : String(error?.message ?? error ?? "");
  if (!text.trim()) return null;
  if (provider === "qwen" && /\bmaximum session turn\b|\bmax(?:imum)? session turns?\b/i.test(text)) {
    return "qwen_max_session_turns";
  }
  if (/\bspawn\b.*\bENOENT\b|\bENOENT\b|\bnot found\b/i.test(text)) {
    return "binary_missing";
  }
  if (/\bE2BIG\b|\bargument list too long\b/i.test(text)) {
    return "argument_list_too_long";
  }
  if (/\b(output|capture|line buffer)\b.*\b(exceeded|overflow)\b/i.test(text)) {
    return "output_overflow";
  }
  if (/\b(timed out|timeout)\b/i.test(text)) {
    return "timeout";
  }
  if (/\b(terminated|SIGTERM|exit(?:ed)? with code 143)\b/i.test(text)) {
    return "terminated";
  }
  if (/\b(interrupted|SIGINT|aborted|cancelled|canceled|exit(?:ed)? with code 130)\b/i.test(text)) {
    return "cancelled";
  }
  if (/\b(no visible text|produced no visible text)\b/i.test(text)) {
    return "no_visible_text";
  }
  if (/\b(auth|authenticated|login|credential)\b/i.test(text)) {
    return "auth";
  }
  return null;
}
