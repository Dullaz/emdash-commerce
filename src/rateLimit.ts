/**
 * Soft rate-limiting for sensitive public routes, as defence-in-depth behind
 * the storefront's captcha (a browser challenge can't cover scripted hits to
 * the public plugin API directly). Fixed-window counters in the plugin KV,
 * keyed by action + dimension (IP and/or identity). Generous thresholds: the
 * goal is to blunt brute-force/enumeration, not to inconvenience real users.
 */
import type { RouteContext } from "emdash";
import { CommerceError } from "./domain";

export interface RateRule {
	/** Dimension name, e.g. "ip" or "email". */
	scope: string;
	/** Identifier value; null/empty dimensions are skipped. */
	id: string | null | undefined;
	/** Max attempts allowed within the window. */
	limit: number;
	/** Window length in seconds. */
	windowSec: number;
}

interface Counter {
	count: number;
	windowStart: number;
}

const tooMany = () =>
	new CommerceError(
		"RATE_LIMITED",
		"Too many attempts. Please wait a few minutes and try again.",
		429,
	);

/**
 * Count this attempt against each rule's window and throw `RATE_LIMITED` if any
 * dimension is over its limit. Increments every dimension that has an id.
 */
export async function enforceRateLimit(
	ctx: RouteContext,
	action: string,
	rules: RateRule[],
): Promise<void> {
	const now = Date.now();
	for (const rule of rules) {
		const id = rule.id?.trim();
		if (!id) continue; // unknown dimension (e.g. no IP) — can't key on it
		const key = `rl:${action}:${rule.scope}:${id}`;
		const cur = (await ctx.kv.get<Counter>(key)) ?? { count: 0, windowStart: now };
		let { count } = cur;
		let windowStart = cur.windowStart;
		if (now - windowStart >= rule.windowSec * 1000) {
			count = 0;
			windowStart = now;
		}
		if (count >= rule.limit) throw tooMany();
		await ctx.kv.set(key, { count: count + 1, windowStart });
	}
}

/** End-user IP for the current request, or null when unavailable. */
export function clientIp(ctx: RouteContext): string | null {
	return ctx.requestMeta?.ip ?? null;
}
