#!/usr/bin/env bash
# The release, in one place, so main and the pull-request dry run cannot drift.
# The publish step once called a build script that did not exist, and nothing
# ran it before main did — alpha.7 and alpha.8 were stranded that way.
#
#   scripts/release.sh version     consume changesets, commit and push the bump,
#                                  decide whether to publish (main only)
#   scripts/release.sh publish     build and publish (main only)
#   scripts/release.sh dry-run     both, without committing, pushing or
#                                  publishing: what every pull request runs
set -euo pipefail
cd "$(dirname "$0")/.."

version() {
	pnpm run version
	# The bump changed every package's version, and the CLI pins them into what
	# `gkm init` scaffolds; synced here, the published CLI installs this release.
	pnpm --filter @geekmidas/cli sync-versions
}

build() {
	# The root build builds every package; there is no per-package build script.
	# Rebuilt after the bump because the CLI's `versions.ts` is compiled in.
	pnpm run build
}

case "${1:-}" in
	version)
		version
		git config user.name "github-actions[bot]"
		git config user.email "github-actions[bot]@users.noreply.github.com"
		git add -A
		bumped=""
		if ! git diff --staged --quiet; then
			git commit -m "chore: version packages"
			git push
			bumped="--bumped"
		fi
		node scripts/release-state.mjs $bumped
		;;
	publish)
		build
		pnpm changeset publish
		;;
	dry-run)
		# It consumes the changesets and rewrites every version in the working
		# tree — fine on a throwaway runner, not on someone's checkout.
		if [ -z "${CI:-}" ]; then
			echo "dry-run rewrites the working tree; it only runs in CI" >&2
			exit 1
		fi
		version
		build
		# Packs and validates every public package without uploading, under the
		# dist-tag `changeset publish` would use.
		tag=$(node -p "try { const p = require('./.changeset/pre.json'); p.mode === 'pre' ? p.tag : 'latest' } catch { 'latest' }")
		pnpm -r publish --dry-run --no-git-checks --tag "$tag"
		;;
	*)
		echo "usage: scripts/release.sh version|publish|dry-run" >&2
		exit 2
		;;
esac
