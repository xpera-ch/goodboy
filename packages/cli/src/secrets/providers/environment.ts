import { GoodBoyError } from '../../lib/errors.js';
import { SecretValue } from '../types.js';
import type { SecretProvider, SecretProviderStatus, SecretResolutionContext } from '../types.js';

/**
 * The `environment` provider (D6). `reference` is the environment variable
 * name itself — an opaque string, not a URI — mirroring D3's `LEGACY_TOKEN`
 * example. No external dependency, so checkAvailability is trivially always
 * available.
 */
export function createEnvironmentProvider(): SecretProvider {
  return {
    id: 'environment',

    async checkAvailability(_ctx: SecretResolutionContext): Promise<SecretProviderStatus> {
      return { available: true };
    },

    async resolve(reference: string, _ctx: SecretResolutionContext): Promise<SecretValue> {
      const value = process.env[reference];
      if (value === undefined) {
        throw new GoodBoyError(`Environment variable "${reference}" is not set.`, {
          code: 'E_SECRET_ENV_VAR_NOT_SET',
          safeMetadata: { reference },
        });
      }
      return new SecretValue(value);
    },
  };
}
