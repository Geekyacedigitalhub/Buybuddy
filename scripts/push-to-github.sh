#!/usr/bin/env bash
# Creates the BUYBUDDY repository under YOUR GitHub account and pushes this codebase.
#
# Usage:
#   ./scripts/push-to-github.sh <github-username> [repo-name] [--private]
#
# Requires either:
#   * GitHub CLI authenticated (`gh auth login`), OR
#   * GITHUB_TOKEN exported with `repo` scope.
set -euo pipefail

USER_NAME="${1:-}"
REPO="${2:-buybuddy}"
VISIBILITY="public"
[[ "${3:-}" == "--private" ]] && VISIBILITY="private"

if [[ -z "$USER_NAME" ]]; then
  echo "Usage: $0 <github-username> [repo-name] [--private]" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if [[ ! -d .git ]]; then
  git init -q
  git add -A
  git -c user.name="BUYBUDDY" -c user.email="dev@buybuddy.local" commit -q -m "feat: BUYBUDDY platform — customer, shopper, rider, merchant and admin apps with API"
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "→ Creating $USER_NAME/$REPO ($VISIBILITY) via GitHub CLI…"
  gh repo create "$USER_NAME/$REPO" --"$VISIBILITY" --source=. --remote=origin --push
elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo "→ Creating $USER_NAME/$REPO ($VISIBILITY) via API…"
  curl -sf -X POST https://api.github.com/user/repos \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"name\":\"$REPO\",\"private\":$([[ $VISIBILITY == private ]] && echo true || echo false),\"description\":\"BUYBUDDY — all-in-one shopping, personal shopper and on-demand delivery marketplace (Nigeria)\"}" >/dev/null
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$USER_NAME/$REPO.git"
  git branch -M main
  git push -u origin main
else
  echo "No GitHub credentials found. Either run 'gh auth login', export GITHUB_TOKEN, or push manually:"
  echo
  echo "  git remote add origin https://github.com/$USER_NAME/$REPO.git"
  echo "  git branch -M main"
  echo "  git push -u origin main"
  exit 1
fi

echo "✅ Pushed to https://github.com/$USER_NAME/$REPO"
