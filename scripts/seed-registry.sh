#!/usr/bin/env bash
# Seed the local GoodBoy registry with the commit-creation skill.
# Usage: bash scripts/seed-registry.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SKILL_SOURCE="$HOME/.claude/skills/commit-creation"

if [[ ! -d "${SKILL_SOURCE}" ]]; then
  echo "Error: ${SKILL_SOURCE} not found." >&2
  exit 1
fi

echo "Seeding commit-creation skill..."
node "${REPO_ROOT}/packages/cli/dist/index.js" add "${SKILL_SOURCE}"
echo "Done."
