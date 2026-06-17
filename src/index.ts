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
import { z } from "astro/zod";
import { definePlugin } from "emdash";
import type { PluginContext, PluginDescriptor, RouteContext } from "emdash";
import {
	DEFAULT_FIELD_MAP,
	type CommerceConfig,
	type CommerceFieldMap,
} from "./constants";
import { loadEffectiveConfig, loadStoredConfig, saveConfig } from "./config";

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
		adminPages: [
			{ path: "/setup", label: "Store setup", icon: "storefront" },
		],
		options,
	};
}

/** Zod schema for the POST body that saves a configuration. */
const configSaveInput = z.object({
	productsCollection: z.string().min(1),
	fieldMap: z.record(z.string(), z.string()),
	defaultCurrency: z.string().min(1).optional(),
});

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
		routes: {
			/**
			 * Read the store configuration (admin-only — protected by the admin
			 * session middleware since it is not marked `public`).
			 * Returns the effective config plus whether it was explicitly saved.
			 */
			config: {
				handler: async (ctx: RouteContext) => {
					const effective = await loadEffectiveConfig(ctx, defaultCurrency);
					return {
						configured: effective.configured,
						config: effective.config,
						stored: await loadStoredConfig(ctx),
						defaultCurrency,
					};
				},
			},
			/** Persist a configuration chosen in the setup panel (admin-only). */
			"config/save": {
				input: configSaveInput,
				handler: async (ctx: RouteContext) => {
					const input = ctx.input as z.infer<typeof configSaveInput>;
					const config: CommerceConfig = {
						productsCollection: input.productsCollection,
						fieldMap: {
							...DEFAULT_FIELD_MAP,
							...(input.fieldMap as CommerceFieldMap),
						},
						defaultCurrency: input.defaultCurrency ?? defaultCurrency,
					};
					await saveConfig(ctx, config);
					ctx.log.info("Commerce config saved", {
						productsCollection: config.productsCollection,
					});
					return { configured: true, config };
				},
			},
		},
		admin: {
			entry: ADMIN_ENTRY,
			pages: [{ path: "/setup", label: "Store setup", icon: "storefront" }],
		},
	});
}

export default createPlugin;
