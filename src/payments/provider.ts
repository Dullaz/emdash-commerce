/**
 * Payment provider abstraction.
 *
 * A provider turns an order into a payment: it starts a checkout (returning
 * where to send the buyer), interprets the provider's webhook/return into an
 * outcome, and issues refunds. Concrete providers live alongside this file
 * (`mock`, `rootline`). The runtime picks one based on plugin settings.
 */
import type { PluginContext } from "emdash";
import type { Order } from "../domain";

export interface CheckoutResult {
	/** Provider-side identifier for this checkout/payment intent. */
	checkoutId: string;
	/** Where to send the buyer to complete payment. */
	redirectUrl: string;
}

export type PaymentOutcome = "paid" | "failed" | "cancelled";

export interface WebhookResult {
	/** Our order id (carried through the provider as a reference). */
	orderId: string;
	outcome: PaymentOutcome;
	providerPaymentId?: string;
}

export interface RefundResult {
	refunded: boolean;
	providerRefundId?: string;
}

export interface CreateCheckoutArgs {
	order: Order;
	ctx: PluginContext;
	/** Absolute URL to return to after a successful payment. */
	returnUrl: string;
	/** Absolute URL to return to if the buyer cancels. */
	cancelUrl: string;
}

export interface HandleWebhookArgs {
	request: Request;
	body: unknown;
	ctx: PluginContext;
}

export interface RefundArgs {
	order: Order;
	/** Amount to refund in minor units. */
	amount: number;
	ctx: PluginContext;
}

export interface PaymentProvider {
	/** Stable id stored on orders and in settings. */
	id: string;
	/** Human label for the admin UI. */
	label: string;
	createCheckout(args: CreateCheckoutArgs): Promise<CheckoutResult>;
	handleWebhook(args: HandleWebhookArgs): Promise<WebhookResult>;
	refund(args: RefundArgs): Promise<RefundResult>;
}

/** Thrown when a provider is selected but its credentials/config are missing. */
export class ProviderNotConfiguredError extends Error {
	constructor(provider: string, detail?: string) {
		super(
			`Payment provider "${provider}" is not configured${detail ? `: ${detail}` : ""}`,
		);
		this.name = "ProviderNotConfiguredError";
	}
}
