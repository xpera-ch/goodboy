const SEGMENT_MASK = '•••';
const QUERY_MASK = '?•••';
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Masks a provider reference for display (e.g. `secrets list`). The scheme
 * prefix (e.g. `op://`) and the path-segment *count* stay visible — enough
 * to tell references apart — but every segment's actual content, and any
 * query string's content, is replaced with a fixed marker. `environment`
 * references are plain variable names, not paths into a vault (§2
 * invariant 3), so they're returned unchanged; a provider type that can't
 * be determined at all is masked exactly like `onepassword-cli` — never
 * assume something unresolved is safe to show in full.
 */
export function maskReference(reference: string, providerType: string | undefined): string {
  if (providerType === 'environment') {
    return reference;
  }

  const queryIndex = reference.indexOf('?');
  const hasQuery = queryIndex !== -1;
  const withoutQuery = hasQuery ? reference.slice(0, queryIndex) : reference;

  const schemeMatch = SCHEME_PATTERN.exec(withoutQuery);
  const prefix = schemeMatch ? schemeMatch[0] : '';
  const rest = withoutQuery.slice(prefix.length);

  const maskedSegments = rest.split('/').map(() => SEGMENT_MASK).join('/');

  return `${prefix}${maskedSegments}${hasQuery ? QUERY_MASK : ''}`;
}
