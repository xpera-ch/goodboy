## Summary

<!-- What does this PR change and why? -->

## Security impact

- [ ] I have read the security requirements in [CONTRIBUTING.md](../CONTRIBUTING.md#security)
- [ ] This PR does **not** touch `hooks.ts`, `manifest.ts`, `registry.ts`, `validation.ts`, or `manifest.schema.json`  
  *(if it does, describe the security impact below)*

<!-- If you touched a security-sensitive file, explain: -->
<!-- - What changed -->
<!-- - Why it is safe -->
<!-- - How you verified the change does not introduce injection, traversal, or validation bypass -->

## Testing

- [ ] `tsc --noEmit` passes with no errors
- [ ] Tested manually against the golden path described above
- [ ] Edge cases considered: <!-- list them or write "N/A" -->

## Checklist

- [ ] One logical change per PR
- [ ] Commit messages follow Conventional Commits
- [ ] No `shell: true`, `eval()`, or `new Function()` introduced
- [ ] No `additionalProperties: true` added to any object in the manifest schema
