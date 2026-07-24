/* AUTO-GENERATED — do not edit by hand */

export interface GoodBoyLocalUserConfig {
  /**
   * Config file schema version. Only ever read/written by the same local CLI installation, so no cross-version tolerance is needed here.
   */
  schema: "1.0.0";
  /**
   * Optional: absent entirely until the user first configures secrets.
   */
  secrets?: {
    /**
     * Provider instance name used for a mapping that omits its own "provider".
     */
    defaultProvider?: string;
    /**
     * Provider instances by instance name. Exactly the two v1 provider types (D6) — widening this union is a schema change for a later version.
     */
    providers?: {
      [k: string]:
        | {
            type: "environment";
          }
        | {
            type: "onepassword-cli";
            /**
             * 1Password account shorthand, URL, or ID (also settable via OP_ACCOUNT).
             */
            account?: string;
            /**
             * Per-invocation timeout for the op CLI.
             */
            timeoutMs?: number;
          };
    };
    /**
     * Logical secret name -> provider reference. Names use the same pattern as manifest.json's requires.secrets.
     */
    mappings?: {
      [k: string]: {
        /**
         * Omittable when secrets.defaultProvider is set.
         */
        provider?: string;
        /**
         * Opaque provider-specific reference. Control characters, newlines, and null bytes are rejected as a defense-in-depth baseline; provider-specific format rules (e.g. op:// prefix) are enforced by the provider module, not here.
         */
        reference: string;
      };
    };
  };
}
