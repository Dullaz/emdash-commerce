/**
 * Customer auth primitives — WebCrypto only (works in Workers and bun).
 * PBKDF2-SHA256 password hashing with a per-password salt, constant-time
 * comparison, and random token/id generation.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toBase64(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function deriveBits(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password) as BufferSource,
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
		key,
		KEY_BITS,
	);
	return new Uint8Array(bits);
}

/** Hash a password → `pbkdf2$<iterations>$<saltB64>$<hashB64>`. */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Verify a password against a stored hash (constant-time). */
export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
	const iterations = Number.parseInt(parts[1], 10);
	if (!Number.isFinite(iterations) || iterations <= 0) return false;
	const salt = fromBase64(parts[2]);
	const expected = fromBase64(parts[3]);
	const actual = await deriveBits(password, salt, iterations);
	if (actual.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
	return diff === 0;
}

/** Random hex token for sessions and one-time links. */
export function randomToken(bytes = 32): string {
	const buf = crypto.getRandomValues(new Uint8Array(bytes));
	let out = "";
	for (const b of buf) out += b.toString(16).padStart(2, "0");
	return out;
}

/** Basic password policy. Returns an error message, or null if acceptable. */
export function passwordProblem(password: string): string | null {
	if (password.length < 8) return "Password must be at least 8 characters";
	if (password.length > 200) return "Password is too long";
	return null;
}
