export interface GoodBoyErrorOptions {
  code: string;
  cause?: unknown;
  /** Data the caller has already vetted as safe to log — this class does not scrub it. */
  safeMetadata?: Record<string, unknown>;
}

/**
 * Shared error base for the secrets feature (D4). Deliberately carries no
 * toJSON/toString override: Node's own Error installs `cause` as a
 * non-enumerable property, so JSON.stringify(error) and default logging
 * never flatten it in — a caller must explicitly read `.cause` to see it.
 * Adding a serializer here later would silently reopen that leak for every
 * consumer, so don't.
 */
export class GoodBoyError extends Error {
  override readonly name = 'GoodBoyError';
  readonly code: string;
  readonly safeMetadata: Record<string, unknown>;

  constructor(message: string, options: GoodBoyErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.code = options.code;
    this.safeMetadata = options.safeMetadata ?? {};
  }
}
