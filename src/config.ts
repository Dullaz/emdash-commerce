/**
 * Runtime helpers for reading/writing the persisted store configuration.
 * Used by plugin routes and (later) the storefront-facing routes.
 */
import type { PluginContext } from "emdash";
import {
	CONFIG_KV_KEY,
	DEFAULT_FIELD_MAP,
	DEFAULT_PRODUCTS_COLLECTION,
	defaultConfig,
	defaultNotifications,
	type CommerceConfig,
} from "./constants";

export interface EffectiveConfig {
	/** True when an admin has explicitly saved a configuration. */
	configured: boolean;
	/** The effective config — falls back to a turnkey default when unset. */
	config: CommerceConfig;
}

/** Read the raw saved config (or null if none has been saved yet). */
export async function loadStoredConfig(
	ctx: PluginContext,
): Promise<CommerceConfig | null> {
	return (await ctx.kv.get<CommerceConfig>(CONFIG_KV_KEY)) ?? null;
}

/**
 * Resolve the effective configuration. If an admin saved one with a chosen
 * collection, that wins (field map merged over the canonical defaults so older
 * partial configs still resolve). Otherwise fall back to a turnkey default that
 * points at the conventional `products` collection — so the store works as soon
 * as that collection exists, even before anyone opens the setup panel.
 */
export async function loadEffectiveConfig(
	ctx: PluginContext,
	defaultCurrency = "USD",
): Promise<EffectiveConfig> {
	const stored = await loadStoredConfig(ctx);
	// Merge over defaults so older configs (saved before notifications existed)
	// still resolve to a complete object.
	const notifications = { ...defaultNotifications(), ...stored?.notifications };
	if (stored?.productsCollection) {
		return {
			configured: true,
			config: {
				productsCollection: stored.productsCollection,
				fieldMap: { ...DEFAULT_FIELD_MAP, ...stored.fieldMap },
				defaultCurrency: stored.defaultCurrency ?? defaultCurrency,
				notifications,
			},
		};
	}
	return {
		configured: false,
		config: {
			...defaultConfig(defaultCurrency),
			productsCollection: DEFAULT_PRODUCTS_COLLECTION,
			notifications,
		},
	};
}

/** Persist a configuration chosen through the setup panel. */
export async function saveConfig(
	ctx: PluginContext,
	config: CommerceConfig,
): Promise<void> {
	await ctx.kv.set(CONFIG_KV_KEY, config);
}
