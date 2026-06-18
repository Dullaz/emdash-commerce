import { describe, expect, test } from "bun:test";
import { hashPassword, passwordProblem, randomToken, verifyPassword } from "./auth";

describe("password hashing", () => {
	test("verifies the correct password", async () => {
		const hash = await hashPassword("correct horse battery");
		expect(await verifyPassword("correct horse battery", hash)).toBe(true);
	});

	test("rejects the wrong password", async () => {
		const hash = await hashPassword("s3cret-pass");
		expect(await verifyPassword("wrong-pass", hash)).toBe(false);
	});

	test("uses a unique salt per hash", async () => {
		const a = await hashPassword("same");
		const b = await hashPassword("same");
		expect(a).not.toBe(b);
		expect(await verifyPassword("same", a)).toBe(true);
		expect(await verifyPassword("same", b)).toBe(true);
	});

	test("rejects malformed stored hashes", async () => {
		expect(await verifyPassword("x", "not-a-hash")).toBe(false);
		expect(await verifyPassword("x", "")).toBe(false);
	});
});

describe("randomToken", () => {
	test("hex length matches byte count and is unique", () => {
		expect(randomToken(32)).toHaveLength(64);
		expect(randomToken(16)).toHaveLength(32);
		expect(randomToken()).not.toBe(randomToken());
	});
});

describe("passwordProblem", () => {
	test("flags short passwords, accepts good ones", () => {
		expect(passwordProblem("short")).toBeTruthy();
		expect(passwordProblem("longenough1")).toBeNull();
	});
});
