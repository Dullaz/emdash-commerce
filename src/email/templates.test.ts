import { describe, expect, test } from "bun:test";
import {
	magicLinkEmail,
	newOrderAdminEmail,
	orderConfirmationEmail,
	orderFulfilledEmail,
	passwordResetEmail,
	refundApprovedEmail,
	refundRequestAdminEmail,
	refundRequestedEmail,
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

describe("order lifecycle emails", () => {
	const order = {
		id: "ord_abc123",
		currency: "USD",
		total: 2000,
		items: [{ title: "1,000 Pixels", quantity: 2, lineTotal: 2000 }],
	};

	test("fulfilled email names the order, items, and lookup link", () => {
		const m = orderFulfilledEmail({
			to: "buyer@test.com",
			order,
			lookupUrl: "https://shop.test/orders/lookup",
		});
		expect(m.to).toBe("buyer@test.com");
		expect(m.subject).toContain("ord_abc123");
		expect(m.text).toContain("1,000 Pixels");
		expect(m.html).toContain("https://shop.test/orders/lookup");
	});

	test("refund-requested email includes the total and optional reason", () => {
		const m = refundRequestedEmail({
			to: "buyer@test.com",
			order,
			reason: "Wrong size",
		});
		expect(m.subject).toContain("ord_abc123");
		expect(m.text).toContain("$20.00");
		expect(m.text).toContain("Wrong size");
		expect(m.html).toContain("Wrong size");
	});

	test("refund-requested email escapes the reason", () => {
		const m = refundRequestedEmail({
			to: "b@test.com",
			order,
			reason: "<script>x</script>",
		});
		expect(m.html).not.toContain("<script>x</script>");
		expect(m.html).toContain("&lt;script&gt;");
	});

	test("new-order admin email lists items, total, customer, and review link", () => {
		const m = newOrderAdminEmail({
			to: "owner@shop.test",
			order,
			customerEmail: "buyer@test.com",
			reviewUrl: "https://shop.test/_emdash/admin/plugins/x/orders",
		});
		expect(m.to).toBe("owner@shop.test");
		expect(m.subject).toContain("ord_abc123");
		expect(m.text).toContain("buyer@test.com");
		expect(m.text).toContain("1,000 Pixels");
		expect(m.text).toContain("$20.00");
		expect(m.html).toContain("https://shop.test/_emdash/admin/plugins/x/orders");
	});

	test("new-order admin email works without a customer email", () => {
		const m = newOrderAdminEmail({ to: "owner@shop.test", order });
		expect(m.text).toContain("ord_abc123");
		expect(m.html).toContain("$20.00");
	});

	test("refund-request admin email names the customer, total, and review link", () => {
		const m = refundRequestAdminEmail({
			to: "owner@shop.test",
			order,
			customerEmail: "buyer@test.com",
			reason: "Changed my mind",
			reviewUrl: "https://shop.test/_emdash/admin/plugins/x/orders",
		});
		expect(m.to).toBe("owner@shop.test");
		expect(m.subject).toContain("ord_abc123");
		expect(m.text).toContain("buyer@test.com");
		expect(m.text).toContain("$20.00");
		expect(m.text).toContain("Changed my mind");
		expect(m.html).toContain("https://shop.test/_emdash/admin/plugins/x/orders");
	});

	test("refund-approved email states the refunded total", () => {
		const m = refundApprovedEmail({ to: "buyer@test.com", order });
		expect(m.subject).toContain("ord_abc123");
		expect(m.text).toContain("$20.00");
		expect(m.html).toContain("$20.00");
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
