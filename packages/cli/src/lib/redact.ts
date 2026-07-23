export const REDACTED_MARKER = '[REDACTED]';

const registeredValues = new Set<string>();

/** Registers a string value to be scrubbed from all future redact() output, for the life of the process. */
export function registerSecret(value: string): void {
  if (value.length === 0) return;
  registeredValues.add(value);
}

/** Test-only escape hatch: clears every registered value. Never called from production code paths. */
export function clearRegisteredSecrets(): void {
  registeredValues.clear();
}

/**
 * Replaces every registered value in `text` with REDACTED_MARKER. Matching
 * is always literal substring replacement (split/join) — a registered value
 * is never compiled into a RegExp, so metacharacters in a secret value can
 * never be misinterpreted as a pattern. Values are applied longest-first so
 * that a registered value which is itself a substring of a longer registered
 * value never fragments the longer one's replacement.
 */
export function redact(text: string): string {
  if (registeredValues.size === 0) return text;

  const longestFirst = [...registeredValues].sort((a, b) => b.length - a.length);
  return longestFirst.reduce((acc, value) => acc.split(value).join(REDACTED_MARKER), text);
}
