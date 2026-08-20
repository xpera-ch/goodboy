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

`main` is protected and takes no direct pushes, so the version bump lands
through a pull request and the tag is pushed once it has merged.

  # Update CHANGELOG.md with the new version section
  # Update version in the package.json files being released
  git switch main && git pull
  git switch -c chore/release-vX.Y.Z
  git add .
  git commit -m "chore: release vX.Y.Z"
  git push -u origin chore/release-vX.Y.Z
  gh pr create --title "chore: release vX.Y.Z" --body "Version bump for vX.Y.Z"

  # after CI is green and the pull request is merged:
  git switch main && git pull
  git tag -a vX.Y.Z -m "GoodBoy vX.Y.Z"
  git push origin vX.Y.Z

Branch protection covers branches, not tags — pushing the tag needs no
pull request. The release workflow handles everything else automatically.

## Verifying a release

After a release workflow completes:

1. Check GitHub Actions:
   github.com/xpera-ch/goodboy/actions

2. Check npm packages:
   npmjs.com/package/@goodboyjs/cli
   npmjs.com/package/@goodboyjs/schema

3. Verify provenance attestation on each package page
   ("Built and signed on GitHub Actions" badge). Versions published
   before the repository went public (@goodboyjs/cli up to 0.2.0,
   @goodboyjs/schema up to 1.1.0) carry no attestation and cannot
   gain one — provenance is attached at publish time only

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
