export const SKILL_NAME_RE = /^[a-z0-9-]+$/;

// Requires at least two characters before "://" so a Windows drive-letter
// path ("C://...") is never mistaken for a URI scheme.
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]+:\/\//i;

// scp-style git remote (e.g. "git@github.com:foo/bar.git"). Anchored to the
// start of the string so an "@" appearing later in an ordinary relative
// path (e.g. "./@scope/foo") is never mistaken for a user@host prefix.
const SCP_STYLE_RE = /^[^\s/:@]+@[^\s/:@]+:\S/;

/** True for a URL-shaped or scp-style argument, false for any local path form. */
export function isRemoteRefArgument(arg: string): boolean {
  return URL_SCHEME_RE.test(arg) || SCP_STYLE_RE.test(arg);
}
