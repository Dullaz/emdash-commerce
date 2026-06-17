import { describe, expect, test } from "bun:test";
import type { PluginContext } from "emdash";
import type { Order } from "../domain";
import { getProvider } from "./index";
import { mockProvider } from "./mock";

const order: Order = {
	id: "ord_test123",
	status: "awaiting_payment",
	items: [
		{ productId: "p1", slug: "p1", title: "P1", unitPrice: 1000, quantity: 2, lineTotal: 2000 },
	],
	currency: "USD",
	subtotal: 2000,
	total: 2000,
	provider: "mock",
	history: [],
	createdAt: "t0",
	updatedAt: "t0",
};

// Minimal fake context — mock provider only uses ctx.url.
const ctx = {
	url: (p: string) => `https://shop.test${p}`,
} as unknown as PluginContext;

describe("provider selection", () => {
	test("resolves known providers by id", () => {
		expect(getProvider("mock").id).toBe("mock");
		expect(getProvider("rootline").id).toBe("rootline");
	});

	test("falls back to mock for unknown/empty ids", () => {
		expect(getProvider("nope").id).toBe("mock");
		expect(getProvider(undefined).id).toBe("mock");
		expect(getProvider(null).id).toBe("mock");
	});
});

describe("mock provider", () => {
	test("createCheckout points at the on-site mock page", async () => {
		const r = await mockProvider.createCheckout({
			order,
			ctx,
			returnUrl: "https://shop.test/checkout/success",
			cancelUrl: "https://shop.test/checkout/cancel",
		});
		expect(r.checkoutId).toBe(order.id);
		expect(r.redirectUrl).toBe(`https://shop.test/checkout/mock/${order.id}`);
	});

	test("handleWebhook maps outcomes", async () => {
		const paid = await mockProvider.handleWebhook({
			request: new Request("https://shop.test/webhook"),
			body: { orderId: "ord_1", outcome: "paid" },
			ctx,
		});
		expect(paid).toMatchObject({ orderId: "ord_1", outcome: "paid" });

		const cancelled = await mockProvider.handleWebhook({
			request: new Request("https://shop.test/webhook"),
			body: { orderId: "ord_1", outcome: "cancelled" },
			ctx,
		});
		expect(cancelled.outcome).toBe("cancelled");

		const failed = await mockProvider.handleWebhook({
			request: new Request("https://shop.test/webhook"),
			body: { orderId: "ord_1", outcome: "whatever" },
			ctx,
		});
		expect(failed.outcome).toBe("failed");
	});

	test("handleWebhook requires orderId", async () => {
		await expect(
			mockProvider.handleWebhook({
				request: new Request("https://shop.test/webhook"),
				body: {},
				ctx,
			}),
		).rejects.toThrow();
	});

	test("refund succeeds", async () => {
		const r = await mockProvider.refund({ order, amount: 2000, ctx });
		expect(r.refunded).toBe(true);
		expect(r.providerRefundId).toContain("mock_refund_");
	});
});
