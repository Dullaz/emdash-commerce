/**
 * Shared, dependency-free constants and types.
 *
 * Imported from every context — the plugin runtime, the React admin bundle, and
 * the Astro storefront — so this module must not import `emdash`, `react`, or
 * anything environment-specific.
 */

/** Stable plugin id. Mirrors `PLUGIN_ID` in index.ts (kept here too so the
 *  browser/storefront can build route URLs without importing the runtime). */
export const PLUGIN_ID = "dullaz-commerce";

/** Base path for this plugin's API routes. */
export const API_BASE = `/_emdash/api/plugins/${PLUGIN_ID}`;

/** KV key holding the persisted store configuration. */
export const CONFIG_KV_KEY = "config";

/** The commerce "roles" a product field can play. */
export type CommerceFieldRole =
	| "title"
	| "price"
	| "currency"
	| "sku"
	| "image"
	| "description"
	| "active";

/** Definition of a required product field, used by the setup panel to create
 *  collections, validate existing ones, and map differently-named fields. */
export interface RequiredFieldDef {
	role: CommerceFieldRole;
	/** Canonical slug used when the plugin creates the field itself. */
	slug: string;
	label: string;
	/** EmDash field type used when creating the field. */
	type: string;
	/** Field types an existing field may have to satisfy this role. */
	compatibleTypes: string[];
	/** Whether the store cannot function without it. */
	required: boolean;
	description: string;
}

/**
 * The commerce data model. Prices are stored as **integer minor units**
 * (e.g. cents) to avoid floating-point money bugs.
 */
export const REQUIRED_FIELDS: RequiredFieldDef[] = [
	{
		role: "title",
		slug: "title",
		label: "Title",
		type: "string",
		compatibleTypes: ["string"],
		required: true,
		description: "Product name shown in the store.",
	},
	{
		role: "price",
		slug: "price",
		label: "Price (minor units)",
		type: "integer",
		compatibleTypes: ["integer", "number"],
		required: true,
		description: "Price in the smallest currency unit, e.g. 2500 = $25.00.",
	},
	{
		role: "currency",
		slug: "currency",
		label: "Currency",
		type: "string",
		compatibleTypes: ["string", "select"],
		required: false,
		description: "ISO-4217 code (e.g. USD). Falls back to the store default.",
	},
	{
		role: "sku",
		slug: "sku",
		label: "SKU",
		type: "string",
		compatibleTypes: ["string"],
		required: false,
		description: "Stock-keeping unit / product code.",
	},
	{
		role: "image",
		slug: "image",
		label: "Image",
		type: "image",
		compatibleTypes: ["image"],
		required: false,
		description: "Primary product image.",
	},
	{
		role: "description",
		slug: "description",
		label: "Description",
		type: "portableText",
		compatibleTypes: ["portableText", "text"],
		required: false,
		description: "Rich product description.",
	},
	{
		role: "active",
		slug: "active",
		label: "Active / for sale",
		type: "boolean",
		compatibleTypes: ["boolean"],
		required: false,
		description: "When false, the product is hidden from the store.",
	},
];

/** Maps each commerce role to the field slug that fills it on the collection. */
export type CommerceFieldMap = Record<CommerceFieldRole, string>;

/** Persisted store configuration. */
export interface CommerceConfig {
	/** Slug of the content collection holding products, or null if unset. */
	productsCollection: string | null;
	/** Role → field-slug mapping for the chosen collection. */
	fieldMap: CommerceFieldMap;
	/** Default ISO-4217 currency when a product has none. */
	defaultCurrency: string;
	/** Store-owner notification preferences (see {@link StoreNotifications}). */
	notifications: StoreNotifications;
}

/**
 * Where and when to email the store owner about ecommerce events. A null/empty
 * `email` disables all owner notifications regardless of the toggles.
 */
export interface StoreNotifications {
	/** Store-owner address notified of the enabled events. */
	email: string | null;
	/** Email the owner when an order is paid. */
	onPurchase: boolean;
	/** Email the owner when a customer requests a refund. */
	onRefundRequest: boolean;
}

/** Default notification preferences (no address → notifications are off). */
export function defaultNotifications(): StoreNotifications {
	return { email: null, onPurchase: true, onRefundRequest: true };
}

/** Canonical map used when the plugin creates the collection itself. */
export const DEFAULT_FIELD_MAP: CommerceFieldMap = {
	title: "title",
	price: "price",
	currency: "currency",
	sku: "sku",
	image: "image",
	description: "description",
	active: "active",
};

/** Collection slug used by the turnkey fallback when nothing is configured. */
export const DEFAULT_PRODUCTS_COLLECTION = "products";

/** Store name used in transactional email copy. */
export const STORE_NAME = "Buy Some Pixels";

export function defaultConfig(defaultCurrency = "USD"): CommerceConfig {
	return {
		productsCollection: null,
		fieldMap: { ...DEFAULT_FIELD_MAP },
		defaultCurrency,
		notifications: defaultNotifications(),
	};
}

/** Format integer minor units + currency for display, e.g. (2500,"USD") → "$25.00". */
export function formatMoney(minorUnits: number, currency: string): string {
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency,
		}).format(minorUnits / 100);
	} catch {
		// Unknown currency code — fall back to a plain decimal + code.
		return `${(minorUnits / 100).toFixed(2)} ${currency}`;
	}
}
