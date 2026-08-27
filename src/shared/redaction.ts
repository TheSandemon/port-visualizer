const FLAG_SECRET =
  /(--(?:api[-_]?key|access[-_]?token|auth(?:orization)?|password|secret|token)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi;
const ENV_SECRET =
  /\b([A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|SECRET|TOKEN)=)("[^"]*"|'[^']*'|[^\s]+)/g;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:)([^@\s]+)(@)/gi;

/** Remove common credentials before command lines enter history, exports, or the renderer. */
export function redactCommandLine(commandLine: string | null | undefined): string | null {
  if (!commandLine) return null;
  return commandLine
    .replace(FLAG_SECRET, '$1<redacted>')
    .replace(ENV_SECRET, '$1<redacted>')
    .replace(URL_CREDENTIALS, '$1<redacted>$3');
}
