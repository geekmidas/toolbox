const githubChangelog = require('@changesets/changelog-github');

/**
 * Gitmoji mappings for common change types
 * @see https://gitmoji.dev/
 */
const GITMOJI = {
	// Features & Enhancements
	feat: '\u2728', // sparkles
	feature: '\u2728',
	add: '\u2728',
	new: '\u2728',

	// Bug Fixes
	fix: '\ud83d\udc1b', // bug
	bugfix: '\ud83d\udc1b',
	hotfix: '\ud83d\ude91', // ambulance

	// Breaking Changes
	breaking: '\ud83d\udca5', // boom

	// Performance
	perf: '\u26a1\ufe0f', // zap
	performance: '\u26a1\ufe0f',

	// Refactoring
	refactor: '\u267b\ufe0f', // recycle
	refactoring: '\u267b\ufe0f',

	// Documentation
	docs: '\ud83d\udcdd', // memo
	doc: '\ud83d\udcdd',
	documentation: '\ud83d\udcdd',

	// Styling
	style: '\ud83d\udc84', // lipstick
	ui: '\ud83d\udc84',

	// Testing
	test: '\u2705', // white_check_mark
	tests: '\u2705',

	// Build & CI
	build: '\ud83d\udc77', // construction_worker
	ci: '\ud83d\udc77',

	// Dependencies
	deps: '\u2b06\ufe0f', // arrow_up
	dep: '\u2b06\ufe0f',
	dependency: '\u2b06\ufe0f',
	dependencies: '\u2b06\ufe0f',
	upgrade: '\u2b06\ufe0f',

	// Security
	security: '\ud83d\udd12', // lock
	sec: '\ud83d\udd12',

	// Configuration
	config: '\ud83d\udd27', // wrench
	configuration: '\ud83d\udd27',

	// Removal
	remove: '\ud83d\udd25', // fire
	delete: '\ud83d\udd25',
	deprecate: '\ud83d\udea8', // rotating_light

	// Types
	types: '\ud83c\udff7\ufe0f', // label
	type: '\ud83c\udff7\ufe0f',
	typescript: '\ud83c\udff7\ufe0f',

	// Chores
	chore: '\ud83e\uddf9', // broom
	cleanup: '\ud83e\uddf9',

	// Initial/Setup
	init: '\ud83c\udf89', // tada
	initial: '\ud83c\udf89',
	setup: '\ud83c\udf89',

	// Accessibility
	a11y: '\u267f\ufe0f', // wheelchair
	accessibility: '\u267f\ufe0f',

	// Internationalization
	i18n: '\ud83c\udf10', // globe_with_meridians
	l10n: '\ud83c\udf10',

	// Database
	db: '\ud83d\uddc4\ufe0f', // card_file_box
	database: '\ud83d\uddc4\ufe0f',
	migration: '\ud83d\uddc4\ufe0f',

	// API
	api: '\ud83d\udd0c', // electric_plug

	// Logging
	log: '\ud83d\udce1', // satellite
	logging: '\ud83d\udce1',

	// Error handling
	error: '\ud83e\udd15', // face_with_head_bandage
	errors: '\ud83e\udd15',

	// Revert
	revert: '\u23ea', // rewind
};

/**
 * Detect gitmoji from changeset summary
 * Looks for patterns like:
 * - Existing emoji at start
 * - Keywords like "feat:", "fix:", etc.
 * - Words in the summary that match gitmoji keywords
 */
function detectGitmoji(summary) {
	const trimmed = summary.trim();

	// Check if already starts with an emoji (common emoji ranges)
	const emojiRegex =
		/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;
	if (emojiRegex.test(trimmed)) {
		return null; // Already has emoji, don't add another
	}

	// Check for conventional commit style prefixes (e.g., "feat:", "fix:")
	const prefixMatch = trimmed.match(/^(\w+)(?:\([^)]*\))?:/i);
	if (prefixMatch) {
		const prefix = prefixMatch[1].toLowerCase();
		if (GITMOJI[prefix]) {
			return GITMOJI[prefix];
		}
	}

	// Check for keywords at the start of the summary
	const firstWord = trimmed
		.split(/\s+/)[0]
		.toLowerCase()
		.replace(/[^a-z]/g, '');
	if (GITMOJI[firstWord]) {
		return GITMOJI[firstWord];
	}

	// Default emoji based on common patterns
	if (/\bbreak(ing|s)?\b/i.test(trimmed)) return GITMOJI.breaking;
	if (/\b(add(ed|s)?|new|introduc(e|ed|es|ing))\b/i.test(trimmed))
		return GITMOJI.feat;
	if (/\b(fix(ed|es)?|bug|patch|resolv(e|ed|es))\b/i.test(trimmed))
		return GITMOJI.fix;
	if (/\b(refactor(ed|s|ing)?)\b/i.test(trimmed)) return GITMOJI.refactor;
	if (/\b(updat(e|ed|es|ing)|upgrad(e|ed|es|ing)|bump(ed|s)?)\b/i.test(trimmed))
		return GITMOJI.deps;
	if (/\b(remov(e|ed|es|ing)|delet(e|ed|es|ing))\b/i.test(trimmed))
		return GITMOJI.remove;
	if (
		/\b(improv(e|ed|es|ing)|enhanc(e|ed|es|ing)|optimi[zs](e|ed|es|ing))\b/i.test(
			trimmed,
		)
	)
		return GITMOJI.perf;

	return null;
}

/**
 * Add gitmoji to the beginning of a changelog line
 */
function addGitmojiToLine(line) {
	// Extract the summary part (after the dash)
	const match = line.match(/^(\s*-\s*)(.+)$/s);
	if (!match) return line;

	const [, prefix, content] = match;
	const emoji = detectGitmoji(content);

	if (emoji) {
		return `${prefix}${emoji} ${content}`;
	}

	return line;
}

/**
 * Process the changelog output to add gitmoji
 */
function processChangelog(changelog) {
	if (!changelog) return changelog;

	// Split into lines and process each
	const lines = changelog.split('\n');
	const processed = lines.map((line) => {
		// Only process lines that start with a dash (changelog entries)
		if (line.trim().startsWith('-')) {
			return addGitmojiToLine(line);
		}
		return line;
	});

	return processed.join('\n');
}

/**
 * Custom changelog functions that wrap @changesets/changelog-github
 * and add gitmoji support
 */
const changelogFunctions = {
	async getReleaseLine(changeset, type, options) {
		const githubLine = await githubChangelog.default.getReleaseLine(
			changeset,
			type,
			options,
		);
		return processChangelog(githubLine);
	},

	async getDependencyReleaseLine(changesets, dependenciesUpdated, options) {
		const githubLine = await githubChangelog.default.getDependencyReleaseLine(
			changesets,
			dependenciesUpdated,
			options,
		);
		return githubLine; // Don't add emoji to dependency updates
	},
};

module.exports = changelogFunctions;
