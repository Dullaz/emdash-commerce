/**
 * @buysomepixels/commerce — EmDash commerce plugin
 *
 * Native-format plugin. Two entry points live in this file because native
 * plugins run in-process:
 *
 *  - `commercePlugin()` — the descriptor factory imported by `astro.config.mjs`
 *    at build time. Side-effect free; returns metadata only.
 *  - `createPlugin()` — the runtime factory EmDash imports from this module's
 *    `entrypoint` and calls with the descriptor's `options`. Returns the
 *    resolved plugin (hooks, routes, storage, admin).
 *
 * Products are modelled as a host content collection the plugin is *configured*
 * to use (EmDash plugins cannot create content schema from their context). The
 * plugin owns orders, inventory, carts and payments in its own storage.
 */
import { definePlugin } from "emdash";
import type { PluginContext, PluginDescriptor } from "emdash";
import { buildRoutes } from "./routes";

/** Stable plugin identity. Must match between descriptor and runtime. */
export const PLUGIN_ID = "buysomepixels-commerce";
export const PLUGIN_VERSION = "0.1.0";

/** The module specifier other config points at (this package's "." export). */
const ENTRYPOINT = "@buysomepixels/commerce";
const ADMIN_ENTRY = "@buysomepixels/commerce/admin";

export interface CommerceOptions {
	/** Default ISO-4217 currency code used when none is set. Defaults to "USD". */
	defaultCurrency?: string;
}

/** Auto-generated settings form: payment provider + rootline staging config. */
const settingsSchema = {
	provider: {
		type: "select" as const,
		label: "Payment provider",
		description: "Which provider processes checkouts.",
		options: [
			{ value: "mock", label: "Mock (test)" },
			{ value: "rootline", label: "Rootline (staging)" },
		],
		default: "mock",
	},
	rootlineBaseUrl: {
		type: "url" as const,
		label: "Rootline base URL (staging)",
		placeholder: "https://staging.rootline.example/api",
	},
	rootlineApiKey: {
		type: "secret" as const,
		label: "Rootline API key",
	},
	rootlineWebhookSecret: {
		type: "secret" as const,
		label: "Rootline webhook secret",
	},
};

/**
 * Descriptor factory — register in `astro.config.mjs`:
 *   emdash({ plugins: [commercePlugin()] })
 */
export function commercePlugin(
	options: CommerceOptions = {},
): PluginDescriptor<CommerceOptions> {
	return {
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		entrypoint: ENTRYPOINT,
		adminEntry: ADMIN_ENTRY,
		format: "native",
		adminPages: [{ path: "/setup", label: "Store setup", icon: "storefront" }],
		options,
	};
}

/**
 * Runtime factory — imported and called by EmDash with `descriptor.options`.
 */
export function createPlugin(options: CommerceOptions = {}) {
	const defaultCurrency = options.defaultCurrency ?? "USD";

	return definePlugin({
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		// content:* to read the configured products collection (and seed demo
		// products); network:request reserved for the rootline PSP (hosts added
		// once its staging details are known).
		capabilities: ["content:read", "content:write", "network:request"],
		allowedHosts: [],
		storage: {
			/** One order per checkout. */
			orders: { indexes: ["status", "provider", "cartToken", "createdAt"] },
			/** Payment attempts/records, linked to an order. */
			payments: { indexes: ["orderId", "provider", "status", "createdAt"] },
			/** Server-side carts, keyed by the cart token cookie. */
			carts: { indexes: ["updatedAt"] },
			/** Authoritative stock per product: { onHand, reserved }. */
			inventory: { indexes: ["productId", "sku"] },
		},
		hooks: {
			"plugin:install": {
				handler: async (_event: unknown, ctx: PluginContext) => {
					ctx.log.info("BuySomePixels commerce installed", { defaultCurrency });
				},
			},
		},
		routes: buildRoutes({ defaultCurrency }),
		admin: {
			entry: ADMIN_ENTRY,
			pages: [{ path: "/setup", label: "Store setup", icon: "storefront" }],
			settingsSchema,
		},
	});
}

export default createPlugin;
