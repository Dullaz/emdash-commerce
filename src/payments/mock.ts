/**
 * Mock payment provider — a fully working, self-contained provider for
 * development and testing. It "hosts" a checkout page on our own site
 * (`/checkout/mock/[orderId]`) where the buyer clicks Pay or Cancel; that page
 * posts the outcome back to the plugin webhook route. No external service.
 */
import type { PaymentProvider } from "./provider";

export const mockProvider: PaymentProvider = {
	id: "mock",
	label: "Mock (test)",

	async createCheckout({ order, ctx }) {
		// One checkout per order; the on-site mock page drives the outcome.
		return {
			checkoutId: order.id,
			redirectUrl: ctx.url(`/checkout/mock/${order.id}`),
		};
	},

	async handleWebhook({ body }) {
		const b = (body ?? {}) as { orderId?: string; outcome?: string };
		if (!b.orderId) throw new Error("Mock webhook missing orderId");
		const outcome =
			b.outcome === "paid"
				? "paid"
				: b.outcome === "cancelled"
					? "cancelled"
					: "failed";
		return {
			orderId: b.orderId,
			outcome,
			providerPaymentId: `mock_${Date.now()}`,
		};
	},

	async refund() {
		return { refunded: true, providerRefundId: `mock_refund_${Date.now()}` };
	},
};
