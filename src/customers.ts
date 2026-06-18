/**
 * Customer storage: accounts, sessions, and one-time tokens (magic-link /
 * verify / reset). Customers are keyed by normalized email; sessions and tokens
 * by a random opaque token.
 */
import type { PluginContext } from "emdash";
import { hashPassword, randomToken } from "./auth";
import { normalizeEmail } from "./domain";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface Customer {
	email: string;
	name?: string;
	passwordHash?: string;
	emailVerified: boolean;
	createdAt: string;
}

export interface CustomerSession {
	token: string;
	email: string;
	createdAt: string;
	expiresAt: string;
}

export type TokenPurpose = "login" | "verify" | "reset";

export interface CustomerToken {
	token: string;
	email: string;
	purpose: TokenPurpose;
	expiresAt: string;
}

/** Public-safe view of a customer (no password hash). */
export function publicCustomer(c: Customer) {
	return { email: c.email, name: c.name ?? null, emailVerified: c.emailVerified };
}

export async function getCustomer(
	ctx: PluginContext,
	email: string,
): Promise<Customer | null> {
	return (await ctx.storage.customers.get(normalizeEmail(email))) as
		| Customer
		| null;
}

export async function upsertCustomer(
	ctx: PluginContext,
	customer: Customer,
): Promise<void> {
	await ctx.storage.customers.put(normalizeEmail(customer.email), customer);
}

/** Create a customer. Throws if one already exists for the email. */
export async function createCustomer(
	ctx: PluginContext,
	args: { email: string; name?: string; password?: string; emailVerified?: boolean },
): Promise<Customer> {
	const email = normalizeEmail(args.email);
	if (await getCustomer(ctx, email)) {
		throw new Error("CUSTOMER_EXISTS");
	}
	const customer: Customer = {
		email,
		name: args.name?.trim() || undefined,
		passwordHash: args.password ? await hashPassword(args.password) : undefined,
		emailVerified: args.emailVerified ?? false,
		createdAt: new Date().toISOString(),
	};
	await upsertCustomer(ctx, customer);
	return customer;
}

export async function setCustomerPassword(
	ctx: PluginContext,
	email: string,
	password: string,
): Promise<void> {
	const existing = await getCustomer(ctx, email);
	const customer: Customer = existing ?? {
		email: normalizeEmail(email),
		emailVerified: true,
		createdAt: new Date().toISOString(),
	};
	customer.passwordHash = await hashPassword(password);
	await upsertCustomer(ctx, customer);
}

export async function markEmailVerified(
	ctx: PluginContext,
	email: string,
): Promise<void> {
	const customer = await getCustomer(ctx, email);
	if (customer && !customer.emailVerified) {
		customer.emailVerified = true;
		await upsertCustomer(ctx, customer);
	}
}

// --- Sessions ---------------------------------------------------------------

export async function createSession(
	ctx: PluginContext,
	email: string,
): Promise<CustomerSession> {
	const now = Date.now();
	const session: CustomerSession = {
		token: randomToken(),
		email: normalizeEmail(email),
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
	};
	await ctx.storage.customer_sessions.put(session.token, session);
	return session;
}

/** Resolve a session token to its (still-valid) session, else null. */
export async function getSession(
	ctx: PluginContext,
	token: string | null | undefined,
): Promise<CustomerSession | null> {
	if (!token) return null;
	const session = (await ctx.storage.customer_sessions.get(token)) as
		| CustomerSession
		| null;
	if (!session) return null;
	if (new Date(session.expiresAt).getTime() < Date.now()) {
		await ctx.storage.customer_sessions.delete(token);
		return null;
	}
	return session;
}

export async function deleteSession(
	ctx: PluginContext,
	token: string | null | undefined,
): Promise<void> {
	if (token) await ctx.storage.customer_sessions.delete(token);
}

// --- One-time tokens (magic-link / verify / reset) --------------------------

export async function createOneTimeToken(
	ctx: PluginContext,
	email: string,
	purpose: TokenPurpose,
): Promise<string> {
	const token = randomToken();
	await ctx.storage.customer_tokens.put(token, {
		token,
		email: normalizeEmail(email),
		purpose,
		expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
	});
	return token;
}

/** Consume a one-time token: deletes it, returns its email if valid + matching. */
export async function consumeOneTimeToken(
	ctx: PluginContext,
	token: string,
	purpose: TokenPurpose,
): Promise<string | null> {
	const result = await consumeAnyToken(ctx, token);
	return result && result.purpose === purpose ? result.email : null;
}

/** Consume a one-time token of any purpose: deletes it, returns email + purpose. */
export async function consumeAnyToken(
	ctx: PluginContext,
	token: string,
): Promise<{ email: string; purpose: TokenPurpose } | null> {
	const record = (await ctx.storage.customer_tokens.get(token)) as
		| CustomerToken
		| null;
	if (!record) return null;
	await ctx.storage.customer_tokens.delete(token); // one-time, even if expired
	if (new Date(record.expiresAt).getTime() < Date.now()) return null;
	return { email: record.email, purpose: record.purpose };
}
