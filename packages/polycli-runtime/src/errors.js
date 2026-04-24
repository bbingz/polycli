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
