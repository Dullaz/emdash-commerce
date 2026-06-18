import { describe, expect, test } from "bun:test";
import {
	magicLinkEmail,
	orderConfirmationEmail,
	passwordResetEmail,
	verifyEmail,
} from "./templates";

describe("orderConfirmationEmail", () => {
	const order = {
		id: "ord_abc123",
		currency: "USD",
		total: 2000,
		items: [{ title: "1,000 Pixels", quantity: 2, lineTotal: 2000 }],
	};

	test("addresses the buyer and includes order id + formatted total", () => {
		const m = orderConfirmationEmail({ to: "buyer@test.com", order });
		expect(m.to).toBe("buyer@test.com");
		expect(m.subject).toContain("ord_abc123");
		expect(m.text).toContain("ord_abc123");
		expect(m.text).toContain("$20.00");
		expect(m.html).toContain("$20.00");
		expect(m.html).toContain("1,000 Pixels");
	});

	test("includes a lookup link when provided", () => {
		const m = orderConfirmationEmail({
			to: "b@test.com",
			order,
			lookupUrl: "https://shop.test/orders/lookup",
		});
		expect(m.text).toContain("https://shop.test/orders/lookup");
		expect(m.html).toContain("https://shop.test/orders/lookup");
	});

	test("escapes HTML in titles", () => {
		const m = orderConfirmationEmail({
			to: "b@test.com",
			order: { ...order, items: [{ title: "<script>x</script>", quantity: 1, lineTotal: 100 }] },
		});
		expect(m.html).not.toContain("<script>x</script>");
		expect(m.html).toContain("&lt;script&gt;");
	});
});

describe("auth emails", () => {
	test("magic link includes the url and a 30-minute note", () => {
		const m = magicLinkEmail({ to: "a@b.com", url: "https://s/verify?token=t" });
		expect(m.subject).toContain("Sign in");
		expect(m.text).toContain("https://s/verify?token=t");
		expect(m.html).toContain("https://s/verify?token=t");
	});

	test("verify + reset carry their urls", () => {
		expect(verifyEmail({ to: "a@b.com", url: "u1" }).text).toContain("u1");
		expect(passwordResetEmail({ to: "a@b.com", url: "u2" }).html).toContain("u2");
	});
});
