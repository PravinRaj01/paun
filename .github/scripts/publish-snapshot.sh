#!/usr/bin/env bash
# Publishes one snapshot file to the `data` branch of the repo in the current directory.
#
#   usage: bash .github/scripts/publish-snapshot.sh <path-to-market-snapshot.json>
#
# Why a script and not inline YAML: it can be tested (ml/tests/test_publish_script.py), and the first version of this
# step only worked on the very FIRST run. Once the `data` branch existed, `git checkout data` aborted because the freshly
# built (untracked) market-snapshot.json sat in the working tree under the same name as the tracked one on `data`.
# So: copy the file somewhere safe first, remove an in-tree copy, and only then switch branches.
set -euo pipefail

main() {
  local src tmp
  src="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  [ -f "$src" ] || { echo "snapshot file not found: $src" >&2; exit 1; }

  tmp="$(mktemp -d)"
  cp "$src" "$tmp/market-snapshot.json"
  cd "$(git rev-parse --show-toplevel)"
  # The only path that can collide with the data branch is the root market-snapshot.json. If an untracked copy is there
  # (build output, or a leftover), remove it: the real file was saved above and is restored after the switch.
  git clean -fq -- market-snapshot.json || true

  git config user.name "paun-snapshot-bot"
  git config user.email "paun-snapshot-bot@users.noreply.github.com"
  if git ls-remote --exit-code --heads origin data >/dev/null 2>&1; then
    git fetch --quiet origin data
    git checkout --quiet -B data origin/data
  else
    git checkout --quiet --orphan data
    git rm -rfq . >/dev/null 2>&1 || true
  fi

  cp "$tmp/market-snapshot.json" market-snapshot.json
  git add market-snapshot.json
  if git diff --cached --quiet; then
    echo "no change"
    return 0
  fi
  git commit --quiet -m "snapshot $(date -u +%F)"
  git push --quiet origin data
  echo "published to data"
}

# main is a function and the last line exits, so bash never re-reads this file after the branch switch removes it
main "$@"
exit $?
