/**
 * Warming a server-rendered site once its stack is up.
 *
 * A site's image is built before the APIs it fetches from run, so its pages
 * render on their first request rather than at build (`GKM_BUILD_OFFLINE`).
 * The warm-up is that first request: the site's `/` and every page its
 * `/sitemap.xml` lists, asked through the edge the way a visitor's browser
 * asks, so a framework that caches a rendered page (Next's ISR) has it cached
 * from the deployed APIs before traffic arrives.
 *
 * Plain HTTP, whatever the framework. A page that fails to warm is said and
 * never fails the deploy: every app is already healthy, and the page renders
 * on the next request that asks for it.
 */

import {
	type EdgeFetch,
	type HealthRequest,
	HealthRequestTimedOut,
	isHealthy,
} from './health';

/** The most pages warmed per site, its `/` included. */
export const WARMUP_MAX_URLS = 500;

/** How many of one site's pages are asked at once. */
export const WARMUP_CONCURRENCY = 4;

/**
 * How long one page has to answer: a first render fetches from the site's
 * APIs, so it is given longer than a health check is.
 */
export const WARMUP_TIMEOUT_MS = 30_000;

/** One request that did not warm its page, and what it got instead. */
export interface WarmupWarning {
	url: string;
	/** `HTTP 500`, or the error the request failed with. */
	reason: string;
}

/** What one site's warm-up did. */
export interface WarmupResult {
	/** Each page that answered, in the order asked. */
	warmed: string[];
	/** Each page — or sitemap — that did not. */
	warnings: WarmupWarning[];
	/** Pages its sitemaps listed beyond {@link WARMUP_MAX_URLS}, not asked. */
	leftOut: number;
}

export interface WarmupOptions {
	/** The site's public URL: `https://<host>`, with the edge's port if any. */
	url: string;
	fetch: EdgeFetch;
	/** How each request reaches the edge: where to connect, the CA, a login. */
	edge?: Pick<
		HealthRequest,
		'ca' | 'connectTo' | 'connectPort' | 'authorization' | 'signal'
	>;
	maxUrls?: number;
	concurrency?: number;
	timeoutMs?: number;
}

/**
 * Asks the site for `/`, then for every page its `/sitemap.xml` lists — a
 * sitemap index's sitemaps followed one level — up to `maxUrls` pages in
 * all, `concurrency` at a time. Only pages on the site's own origin are
 * asked: a sitemap may list another's, which this deploy did not start.
 */
export async function warmSite(options: WarmupOptions): Promise<WarmupResult> {
	const {
		fetch,
		edge = {},
		maxUrls = WARMUP_MAX_URLS,
		concurrency = WARMUP_CONCURRENCY,
		timeoutMs = WARMUP_TIMEOUT_MS,
	} = options;
	const origin = new URL(options.url).origin;
	const result: WarmupResult = { warmed: [], warnings: [], leftOut: 0 };

	/** One GET; a failure is a warning, and `undefined`. */
	const get = async (
		url: string,
		read: boolean,
	): Promise<{ status: number; body: string } | undefined> => {
		try {
			return await fetch({ url, ...edge, timeoutMs, read });
		} catch (error) {
			if (edge.signal?.aborted) throw error;
			result.warnings.push({
				url,
				reason:
					error instanceof HealthRequestTimedOut
						? `no answer within ${error.timeoutMs}ms`
						: error instanceof Error
							? error.message
							: String(error),
			});
			return undefined;
		}
	};

	const warm = async (url: string): Promise<void> => {
		const response = await get(url, false);
		if (!response) return;
		if (isHealthy(response.status)) result.warmed.push(url);
		else result.warnings.push({ url, reason: `HTTP ${response.status}` });
	};

	/** A sitemap's `<loc>`s, or none where it has none — or did not answer. */
	const sitemap = async (url: string): Promise<Sitemap | undefined> => {
		const response = await get(url, true);
		if (!response) return undefined;
		// A site with no sitemap answers 404 (or asks for a login it was not
		// given): nothing to follow, and nothing wrong.
		if (response.status >= 400 && response.status < 500) return undefined;
		if (!isHealthy(response.status)) {
			result.warnings.push({ url, reason: `HTTP ${response.status}` });
			return undefined;
		}
		return readSitemap(response.body);
	};

	const root = `${origin}/`;
	await warm(root);

	const pages = new Set<string>([root]);
	const sameOrigin = (loc: string): string | undefined => {
		if (!URL.canParse(loc, root)) return undefined;
		const url = new URL(loc, root);
		url.hash = '';
		return url.origin === origin ? url.href : undefined;
	};
	const list = (locs: readonly string[]) => {
		for (const loc of locs) {
			const url = sameOrigin(loc);
			if (url) pages.add(url);
		}
	};

	const top = await sitemap(`${origin}/sitemap.xml`);
	if (top?.kind === 'index') {
		// One level: a sitemap an index lists is read; an index it lists is not.
		const children = [
			...new Set(top.locs.map(sameOrigin).filter((u) => u !== undefined)),
		];
		const read = await pool(children, concurrency, sitemap);
		for (const child of read) {
			if (child?.kind === 'urlset') list(child.locs);
		}
	} else if (top) {
		list(top.locs);
	}

	const listed = [...pages].slice(1);
	const room = Math.max(0, maxUrls - 1);
	result.leftOut = Math.max(0, listed.length - room);
	await pool(listed.slice(0, room), concurrency, warm);

	return result;
}

/** A sitemap's kind and the `<loc>` of each entry. */
export interface Sitemap {
	/** `index` lists sitemaps; `urlset` lists pages. */
	kind: 'index' | 'urlset';
	locs: string[];
}

/**
 * Reads a sitemap (sitemaps.org): each entry's `<loc>`, entity-decoded or
 * from CDATA. Only an unprefixed `<loc>` is an entry's — an `<image:loc>` is
 * an image on a page, not a page.
 */
export function readSitemap(xml: string): Sitemap {
	const kind = /<(?:[\w-]+:)?sitemapindex[\s>]/.test(xml) ? 'index' : 'urlset';
	const locs: string[] = [];
	for (const match of xml.matchAll(
		/<loc>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/loc>/g,
	)) {
		const loc = match[1] ?? decodeEntities(match[2] ?? '');
		if (loc.trim()) locs.push(loc.trim());
	}
	return { kind, locs };
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
};

function decodeEntities(text: string): string {
	return text.replace(
		/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
		(whole, entity: string) => {
			if (entity[0] === '#') {
				const code =
					entity[1] === 'x' || entity[1] === 'X'
						? Number.parseInt(entity.slice(2), 16)
						: Number.parseInt(entity.slice(1), 10);
				return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
			}
			return ENTITIES[entity.toLowerCase()] ?? whole;
		},
	);
}

/** Each item through `run`, at most `size` at once, results in order. */
async function pool<T, R>(
	items: readonly T[],
	size: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await run(items[index]!);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, worker),
	);
	return results;
}
