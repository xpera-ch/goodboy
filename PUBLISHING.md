# Publishing GoodBoy to npm

GoodBoy uses npm Trusted Publishing (OIDC) for all releases
after the initial publish. No long-lived npm tokens are stored
in GitHub Secrets.

## How it works

When a version tag (v*.*.*) is pushed to GitHub, the release
workflow:
1. Runs tests on Node.js 20 and 22
2. Builds all packages
3. Publishes @goodboyjs/schema, @goodboyjs/registry-client,
   and @goodboyjs/cli to npm using OIDC authentication
4. Creates a GitHub Release with the changelog excerpt

npm verifies the publish request came from the exact workflow
in this repository using a short-lived cryptographic token.
No token is stored anywhere.

## First publish (one-time setup for v0.1.0)

npm Trusted Publishing requires each package to exist on npm
before it can be configured. The very first publish must use
a temporary token.

### Step 1 — Prerequisites

- npm account with access to the goodboyjs organisation
- Repository transferred to github.com/xpera-ch/goodboy
- Local remote updated:
  git remote set-url origin https://github.com/xpera-ch/goodboy.git

### Step 2 — Create a temporary npm token

1. Go to npmjs.com → Avatar → Access Tokens
2. Click "Generate New Token" → "Classic Token"
3. Type: Automation (bypasses 2FA for CI use)
4. Scope: Read and Write
5. Copy the token — you will use it once and then delete it

### Step 3 — Add token to GitHub Secrets temporarily

1. Go to github.com/xpera-ch/goodboy → Settings
2. Secrets and variables → Actions → New repository secret
3. Name: NPM_TOKEN
4. Value: paste the token from Step 2

### Step 4 — Use the temporary token-based workflow

Do not edit release.yml for the first publish. Use
.github/workflows/release-first-publish.yml instead — it is
the token-based variant kept in the repo for exactly this
purpose and is triggered manually via workflow_dispatch.

### Step 5 — Tag and push v0.1.0

  git tag -a v0.1.0 -m "GoodBoy v0.1.0

  First public release. A personal skill registry and
  intelligent dispatcher for Claude Code and the Agent
  Skills ecosystem.

  352 tests · 99.7% coverage · MIT License
  https://goodboy.io"

  git push origin main
  git push origin v0.1.0

Then go to GitHub Actions → "Release (First Publish)" →
Run workflow → enter tag v0.1.0 → Run.

Wait for the workflow to complete and verify all three
packages appear on npmjs.com.

### Step 6 — Configure Trusted Publishing on npmjs.com

Do this for each of the three packages.
Repeat these steps three times:

For @goodboyjs/schema:
1. Go to npmjs.com/package/@goodboyjs/schema
2. Click Settings
3. Find "Trusted Publisher" section
4. Click "GitHub Actions"
5. Fill in:
   - GitHub org or user: xpera-ch
   - Repository: goodboy
   - Workflow filename: release.yml
   - Environment name: (leave blank)
   - Allowed actions: npm publish
6. Click Save

Repeat for @goodboyjs/registry-client and @goodboyjs/cli.

### Step 7 — Confirm release.yml is already on OIDC

release.yml already uses OIDC Trusted Publishing (no NPM_TOKEN,
no NODE_AUTH_TOKEN, id-token: write permission, --provenance on
every publish step). Nothing to change here — it's ready for
all future releases as soon as Step 6 is done.

### Step 8 — Clean up temporary credentials

1. Delete NPM_TOKEN from GitHub Secrets:
   Settings → Secrets and variables → Actions
   → NPM_TOKEN → Delete

2. Delete the temporary npm token:
   npmjs.com → Avatar → Access Tokens
   → Find the token created in Step 2 → Delete

3. Delete .github/workflows/release-first-publish.yml
   (or leave it disabled — it only runs via manual
   workflow_dispatch, never on a tag push).

After this point no long-lived npm token exists anywhere.
All future releases are fully automated via OIDC.

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
   npmjs.com/package/@goodboyjs/registry-client

3. Verify provenance attestation on each package page
   ("Built and signed on GitHub Actions" badge)

4. Test the published CLI:
   npm install -g @goodboyjs/cli
   goodboy --version

## Troubleshooting

OIDC auth fails — "Trusted Publisher not configured":
- Verify Trusted Publishing is set up for all three packages
- Verify workflow filename matches exactly: release.yml
- Verify org name matches exactly: xpera-ch
- Verify repo name matches exactly: goodboy

Package not found after publish:
- npm search index takes a few minutes to update
- Check npmjs.com directly — search is slower than the registry

Wrong files published:
- Run npm pack --dry-run locally to check before tagging
- Verify the files field in package.json is correct
