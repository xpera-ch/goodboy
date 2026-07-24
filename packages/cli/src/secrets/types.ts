import { registerSecret, REDACTED_MARKER } from '../lib/redact.js';

// Deliberately minimal placeholder shapes. environment's checkAvailability
// has nothing more meaningful to report than "yes, always available", and
// there is no resolution context beyond an AbortSignal yet. onepassword-cli
// (S4c) may need to extend SecretResolutionContext (e.g. an account
// override) — that's an S4c design call, not guessed at here.

export interface SecretProviderStatus {
  available: boolean;
  detail?: string;
}

export interface SecretResolutionContext {
  signal?: AbortSignal;
}

export interface SecretProvider {
  readonly id: string;
  checkAvailability(ctx: SecretResolutionContext): Promise<SecretProviderStatus>;
  resolve(reference: string, ctx: SecretResolutionContext): Promise<SecretValue>;
}

const INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom');

/**
 * Wraps a resolved secret value. This is accidental-disclosure prevention,
 * not memory protection: it stops the value from being casually printed,
 * logged, or serialized — it does not defend against a memory dump or a
 * malicious dependency walking the object graph. Construction registers the
 * value with the redactor (lib/redact.ts), so it is also scrubbed from any
 * logger/sanitiseError output that happens to include it verbatim.
 */
export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
    registerSecret(value);
  }

  /** The one deliberate escape hatch. Every other accessor returns REDACTED_MARKER. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED_MARKER;
  }

  toJSON(): string {
    return REDACTED_MARKER;
  }

  [INSPECT_CUSTOM](): string {
    return REDACTED_MARKER;
  }
}
