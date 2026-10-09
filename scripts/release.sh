#!/usr/bin/env bash
# The release, in one place, so main and the pull-request dry run cannot drift.
# The publish step once called a build script that did not exist, and nothing
# ran it before main did — alpha.7 and alpha.8 were stranded that way.
#
#   scripts/release.sh sync        commit the CLI's synced version pins (main only)
#   scripts/release.sh version     consume changesets, commit and push the bump,
#                                  decide whether to publish (main only)
#   scripts/release.sh publish     build and publish (main only)
#   scripts/release.sh dry-run     both, without committing, pushing or
#                                  publishing: what every pull request runs
set -euo pipefail
cd "$(dirname "$0")/.."

# Push, or stand down if main has moved past this run.
#
# Two merges in quick succession start two runs; the older one's push is then
# rejected. Rebasing onto the newer main and pushing anyway would release code
# this run never tested, so it stops instead: the run for the newer commit
# syncs, versions and publishes everything, this one included. `origin/main`
# still being an ancestor of HEAD means nobody else pushed — our own earlier
# step's push is fine — so a failure then is a real one.
push_or_stand_down() {
	if git push origin HEAD:main; then
		return 0
	fi
	git fetch -q origin main
	if git merge-base --is-ancestor origin/main HEAD; then
		echo "Push to main failed, and main has not moved." >&2
		exit 1
	fi
	echo "main moved past this run; the run for the newer commit takes over."
	return 1
}

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
			if ! push_or_stand_down; then
				echo "publish=false" >> "${GITHUB_OUTPUT:-/dev/null}"
				exit 0
			fi
			bumped="--bumped"
		fi
		node scripts/release-state.mjs $bumped
		;;
	sync)
		# The CLI pins every package's version into what `gkm init` scaffolds.
		pnpm --filter @geekmidas/cli sync-versions
		git config user.name "github-actions[bot]"
		git config user.email "github-actions[bot]@users.noreply.github.com"
		git add packages/cli/src/init/versions.ts
		if ! git diff --staged --quiet; then
			git commit -m "chore(cli): sync package versions"
			push_or_stand_down || exit 0
		fi
		;;
	publish)
		# The commit being released, pushed by `version` (or already on main):
		# `gkm init` pins the stages action it scaffolds to it.
		GKM_RELEASE_COMMIT=$(git rev-parse HEAD)
		export GKM_RELEASE_COMMIT
		build
		# npm signs each package's provenance with Sigstore, and a dropped
		# connection there fails that package mid-release (alpha.94 went out
		# without auth and errors). `changeset publish` skips what npm already
		# has, so another attempt publishes only what is missing.
		for attempt in 1 2 3; do
			if pnpm changeset publish; then
				exit 0
			fi
			echo "Publish attempt ${attempt} failed; retrying what is missing." >&2
			sleep $((attempt * 20))
		done
		exit 1
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
		echo "usage: scripts/release.sh sync|version|publish|dry-run" >&2
		exit 2
		;;
esac
