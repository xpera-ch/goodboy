# Publishing GoodBoy to npm

GoodBoy uses npm Trusted Publishing (OIDC) for all releases
after the initial publish. No long-lived npm tokens are stored
in GitHub Secrets.

## How it works

When a version tag (v*.*.*) is pushed to GitHub, the release
workflow:
1. Runs tests on Node.js 24 and 26
2. Builds all packages
3. Publishes @goodboyjs/schema and @goodboyjs/cli to npm
   using OIDC authentication (@goodboyjs/registry-client stays in
   the monorepo but is not published — see `docs/backlog.md`,
   "packages/registry-client is a 44-line stub")
4. Creates a GitHub Release with the changelog excerpt

npm verifies the publish request came from the exact workflow
in this repository using a short-lived cryptographic token.
No token is stored anywhere.

## First publish

The Trusted Publishing bootstrap (temporary npm token, one-time manual
setup) ran once, for `v0.1.0` (2026-07-15) — see
`docs/first-publish-bootstrap.md` for the generalized procedure if a new
package ever needs this same setup again. Reference notes, not a
maintained runbook.

## All future releases

Every release after v0.1.0 is a single command:

  # Update CHANGELOG.md with the new version section
  # Update version in all package.json files
  git add .
  git commit -m "chore: release vX.Y.Z"
  git tag -a vX.Y.Z -m "GoodBoy vX.Y.Z"
  git push origin main
  git push origin vX.Y.Z

The release workflow handles everything else automatically.

## Verifying a release

After a release workflow completes:

1. Check GitHub Actions:
   github.com/xpera-ch/goodboy/actions

2. Check npm packages:
   npmjs.com/package/@goodboyjs/cli
   npmjs.com/package/@goodboyjs/schema

3. Verify provenance attestation on each package page
   ("Built and signed on GitHub Actions" badge) — only after
   --provenance is re-added at the go-public flip; absent while
   the repository is private

4. Test the published CLI:
   npm install -g @goodboyjs/cli
   goodboy --version

## Troubleshooting

OIDC auth fails — "Trusted Publisher not configured":
- Verify Trusted Publishing is set up for both packages
- Verify workflow filename matches exactly: release.yml
- Verify org name matches exactly: xpera-ch
- Verify repo name matches exactly: goodboy

Package not found after publish:
- npm search index takes a few minutes to update
- Check npmjs.com directly — search is slower than the registry

Wrong files published:
- Run npm pack --dry-run locally to check before tagging
- Verify the files field in package.json is correct
