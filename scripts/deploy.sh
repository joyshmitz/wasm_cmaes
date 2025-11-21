#!/usr/bin/env bash
set -euo pipefail

# Full deployment helper:
# 1) Build both wasm bundles (sequential + parallel) for GitHub Pages.
# 2) Stage generated artifacts (pkg/, pkg-par/, favicon, examples, etc.).
# 3) Commit (if needed) and push to origin main.
# 4) Ensure GitHub Pages is enabled on main at path /. Requires gh CLI auth.

ROOT="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)"
cd "$ROOT"

MSG=${1:-"chore: deploy pages"}

echo ":: building bundles"
scripts/build-all.sh

echo ":: staging files"
git add .

if git diff --cached --quiet; then
  echo ":: no changes to commit"
else
  echo ":: committing: $MSG"
  git commit -m "$MSG"
fi

echo ":: pushing to origin main"
git push -u origin main

if command -v gh >/dev/null 2>&1; then
  echo ":: ensuring GitHub Pages enabled (main, path /)"
  repo="$(git config --get remote.origin.url | sed -E 's#(git@github.com:|https://github.com/)##;s#.git$##')"
  gh api --method POST repos/"$repo"/pages \
    -f "source[branch]=main" -f "source[path]=/" >/dev/null || true
else
  echo ":: gh not found; skip enabling Pages"
fi

echo ":: done"
