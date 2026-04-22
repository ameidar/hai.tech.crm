#!/bin/bash
# HaiTech CRM — Tag a release from the dev machine.
# Run this after a PR is merged from dev → main.
#
# Reads backend/package.json version, creates an annotated tag vX.Y.Z on the
# current HEAD of origin/main, and pushes it. Fails loudly if the version
# wasn't bumped (tag already exists).
#
# Usage: from the repo root on the dev machine (187.124.2.69):
#   ./scripts/tag-release.sh
set -e

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

# Fetch latest refs without switching branches
git fetch origin --quiet

# Read version from package.json (source of truth)
VERSION=$(node -p "require('./backend/package.json').version")
TAG="v${VERSION}"

# Always tag the current main head on origin
TARGET_SHA=$(git rev-parse origin/main)
SHORT_SHA=$(git rev-parse --short origin/main)

echo "📌 Version:  ${TAG}"
echo "📍 Commit:   ${SHORT_SHA} (origin/main)"

# Guard: tag already exists locally or on origin → likely forgot to bump version
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "❌ Tag ${TAG} already exists locally. Did you forget to bump backend/package.json version?"
  exit 1
fi
if git ls-remote --tags origin "refs/tags/${TAG}" | grep -q .; then
  echo "❌ Tag ${TAG} already exists on origin. Did you forget to bump backend/package.json version?"
  exit 1
fi

git tag -a "$TAG" "$TARGET_SHA" -m "Release ${TAG} (${SHORT_SHA})"
git push origin "$TAG"

echo "✅ Tag ${TAG} pushed to origin → ${TARGET_SHA}"
echo "🔗 https://github.com/ameidar/hai.tech.crm/releases/tag/${TAG}"
