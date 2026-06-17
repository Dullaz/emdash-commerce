/**
 * Rootline payment provider (staging) — scaffolded.
 *
 * Rootline is the real PSP this store will use; we target its **staging**
 * environment. The exact endpoints, auth scheme, webhook signature, and
 * amount/currency conventions will be confirmed once those details arrive, so
 * the request shapes below are provisional and marked with TODOs. Until the
 * base URL + API key are set in plugin settings, every method fails fast with a
 * clear "not configured" error rather than guessing.
 *
 * Credentials are read from plugin settings (encrypted `secret` fields), not
 * hardcoded.
 */
import { getPluginSetting } from "emdash";
import { PLUGIN_ID } from "../constants";
import { ProviderNotConfiguredError, type PaymentProvider } from "./provider";

interface RootlineConfig {
	baseUrl: string;
	apiKey: string;
	webhookSecret: string;
}

async function loadRootlineConfig(): Promise<RootlineConfig | null> {
	const [baseUrl, apiKey, webhookSecret] = await Promise.all([
		getPluginSetting<string>(PLUGIN_ID, "rootlineBaseUrl"),
		getPluginSetting<string>(PLUGIN_ID, "rootlineApiKey"),
		getPluginSetting<string>(PLUGIN_ID, "rootlineWebhookSecret"),
	]);
	if (!baseUrl || !apiKey) return null;
	return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, webhookSecret: webhookSecret ?? "" };
}

export const rootlineProvider: PaymentProvider = {
	id: "rootline",
	label: "Rootline (staging)",

	async createCheckout({ order, ctx, returnUrl, cancelUrl }) {
		const cfg = await loadRootlineConfig();
		if (!cfg) {
			throw new ProviderNotConfiguredError(
				"rootline",
				"set the staging base URL and API key in plugin settings",
			);
		}
		if (!ctx.http) {
			throw new ProviderNotConfiguredError(
				"rootline",
				"network access is unavailable to the plugin",
			);
		}
		// TODO(rootline): confirm endpoint + request body once staging docs land.
		const res = await ctx.http.fetch(`${cfg.baseUrl}/v1/checkouts`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${cfg.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				amount: order.total,
				currency: order.currency,
				reference: order.id,
				return_url: returnUrl,
				cancel_url: cancelUrl,
			}),
		});
		if (!res.ok) {
			throw new Error(`rootline checkout failed (HTTP ${res.status})`);
		}
		const data = (await res.json()) as { id?: string; url?: string };
		if (!data.id || !data.url) {
			throw new Error("rootline checkout response missing id/url");
		}
		return { checkoutId: data.id, redirectUrl: data.url };
	},

	async handleWebhook({ body }) {
		const cfg = await loadRootlineConfig();
		if (!cfg) throw new ProviderNotConfiguredError("rootline");
		// TODO(rootline): verify the webhook signature against cfg.webhookSecret
		// once the header name + signing scheme are known.
		const b = (body ?? {}) as {
			reference?: string;
			status?: string;
			payment_id?: string;
		};
		if (!b.reference) throw new Error("rootline webhook missing reference");
		const outcome =
			b.status === "succeeded"
				? "paid"
				: b.status === "cancelled"
					? "cancelled"
					: "failed";
		return { orderId: b.reference, outcome, providerPaymentId: b.payment_id };
	},

	async refund({ order }) {
		const cfg = await loadRootlineConfig();
		if (!cfg) throw new ProviderNotConfiguredError("rootline");
		if (!order.providerPaymentId) {
			throw new Error("order has no rootline payment to refund");
		}
		// TODO(rootline): wire POST /v1/refunds once staging details arrive.
		throw new ProviderNotConfiguredError(
			"rootline",
			"refunds are not wired yet — pending rootline staging details",
		);
	},
};
