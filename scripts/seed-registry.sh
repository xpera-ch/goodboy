#!/usr/bin/env bash
# Seed the local GoodBoy registry with the commit-creation skill.
# Usage: bash scripts/seed-registry.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SKILLS_SRC="${REPO_ROOT}/skills"

if [[ ! -d "${SKILLS_SRC}/commit-creation" ]]; then
  echo "Error: ${SKILLS_SRC}/commit-creation not found." >&2
  exit 1
fi

echo "Seeding commit-creation skill..."
node "${REPO_ROOT}/packages/cli/dist/index.js" add "${SKILLS_SRC}/commit-creation"
echo "Done."
