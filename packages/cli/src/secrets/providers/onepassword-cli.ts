import { runCapture } from '../../lib/process.js';
import { GoodBoyError } from '../../lib/errors.js';
import { SecretValue } from '../types.js';
import type { SecretProvider, SecretProviderStatus, SecretResolutionContext } from '../types.js';
import type { SecretProviderConfigOnePasswordCli } from '../config.js';

const OP_REFERENCE_PREFIX = 'op://';

function accountArgs(config: SecretProviderConfigOnePasswordCli): string[] {
  return config.account !== undefined ? ['--account', config.account] : [];
}

function runOptions(config: SecretProviderConfigOnePasswordCli, ctx: SecretResolutionContext) {
  return {
    signal: ctx.signal,
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  };
}

/**
 * The `onepassword-cli` provider (D6). Shells out to the real `op` CLI via
 * lib/process.ts's runCapture — never a shell, and never `op run` (that's
 * S5's injection concern). `opBinary` is a test seam only: production call
 * sites never pass it, always resolving `op` from PATH.
 */
export function createOnePasswordCliProvider(
  config: SecretProviderConfigOnePasswordCli,
  opBinary = 'op',
): SecretProvider {
  return {
    id: 'onepassword-cli',

    async checkAvailability(ctx: SecretResolutionContext): Promise<SecretProviderStatus> {
      let result;
      try {
        result = await runCapture(opBinary, ['whoami', ...accountArgs(config)], runOptions(config, ctx));
      } catch {
        // runCapture rejects only for a genuine invocation failure (e.g. op
        // not on PATH). checkAvailability must never throw — translate into
        // an unavailable status instead.
        return { available: false, detail: 'op CLI not found' };
      }

      if (result.exitCode === 0) {
        return { available: true };
      }

      // A short, fixed phrase rather than echoing stderr verbatim: stderr
      // is real 1Password CLI output this code doesn't fully control, and
      // detail is meant to be safe to display/log as-is.
      return { available: false, detail: 'not authenticated' };
    },

    async resolve(reference: string, ctx: SecretResolutionContext): Promise<SecretValue> {
      if (!reference.startsWith(OP_REFERENCE_PREFIX) || reference.length === OP_REFERENCE_PREFIX.length) {
        throw new GoodBoyError(
          `Invalid onepassword-cli reference: must start with "${OP_REFERENCE_PREFIX}" and have a non-empty remainder.`,
          { code: 'E_SECRET_REFERENCE_INVALID', safeMetadata: { reference } },
        );
      }

      const args = ['read', reference, '--no-newline', ...accountArgs(config)];

      let result;
      try {
        result = await runCapture(opBinary, args, runOptions(config, ctx));
      } catch (err) {
        throw new GoodBoyError(`Failed to invoke onepassword-cli while resolving "${reference}".`, {
          code: 'E_SECRET_RESOLVE_FAILED',
          cause: err,
          safeMetadata: { reference },
        });
      }

      if (result.exitCode !== 0) {
        // Message names the reference (locally configured, not a secret)
        // but never the raw stderr — that goes in safeMetadata instead, so
        // it's retrievable by a caller that wants it without it being
        // dumped into a user-facing message by default.
        throw new GoodBoyError(`Failed to resolve secret reference "${reference}" via onepassword-cli.`, {
          code: 'E_SECRET_RESOLVE_FAILED',
          safeMetadata: {
            reference,
            stderr: result.stderr,
            timedOut: result.timedOut,
            truncated: result.truncated,
          },
        });
      }

      return new SecretValue(result.stdout);
    },
  };
}
