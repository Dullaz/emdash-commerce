/**
 * Plugin API routes. Storefront-facing routes (cart, checkout, webhook, order,
 * availability) are `public`; configuration routes are admin-only.
 */
import { z } from "astro/zod";
import { PluginRouteError } from "emdash";
import type { PluginContext, PluginRoute, RouteContext } from "emdash";
import {
	DEFAULT_FIELD_MAP,
	type CommerceConfig,
	type CommerceFieldMap,
} from "./constants";
import { loadEffectiveConfig, loadStoredConfig, saveConfig } from "./config";
import {
	computeTotals,
	holdsReservation,
	InsufficientStockError,
	lineItemsFromCart,
	mergeCartItem,
	setCartItemQuantity,
	transition,
	type Cart,
	type CartItem,
	type Order,
} from "./domain";
import { getActiveProvider, getProvider, loadProviderId } from "./payments";
import {
	commitItems,
	deleteCart,
	getAvailability,
	getCart,
	getOrder,
	releaseItems,
	reserveItems,
	saveCart,
	saveOrder,
} from "./store";

function query(ctx: RouteContext, key: string): string | null {
	return new URL(ctx.request.url).searchParams.get(key);
}

const badRequest = (message: string) =>
	new PluginRouteError("BAD_REQUEST", message, 400);
const notFound = (message: string) =>
	new PluginRouteError("NOT_FOUND", message, 404);

function newOrderId(): string {
	const rand =
		typeof crypto !== "undefined" && crypto.randomUUID
			? crypto.randomUUID().replace(/-/g, "")
			: Math.random().toString(36).slice(2) + Date.now().toString(36);
	return `ord_${rand.slice(0, 24)}`;
}

function cartSummary(cart: Cart) {
	return { token: cart.token, items: cart.items, totals: computeTotals(cart.items) };
}

/** Load a product from the configured collection and build a cart line. */
async function buildCartItem(
	ctx: PluginContext,
	config: CommerceConfig,
	productId: string,
): Promise<Omit<CartItem, "quantity">> {
	if (!ctx.content) throw badRequest("Content access is unavailable");
	if (!config.productsCollection) throw badRequest("Store is not configured");
	const product = await ctx.content.get(config.productsCollection, productId);
	if (!product || product.status !== "published") {
		throw notFound("Product not available");
	}
	const fm = config.fieldMap;
	const data = product.data;
	if (data[fm.active] === false) throw badRequest("Product is not for sale");
	const unitPrice = Math.round(Number(data[fm.price] ?? Number.NaN));
	if (!Number.isFinite(unitPrice) || unitPrice < 0) {
		throw badRequest("Product has no valid price");
	}
	return {
		productId,
		slug: product.slug ?? productId,
		title: String(data[fm.title] ?? product.slug ?? productId),
		unitPrice,
		currency: String(data[fm.currency] || config.defaultCurrency),
	};
}

const configSaveInput = z.object({
	productsCollection: z.string().min(1),
	fieldMap: z.record(z.string(), z.string()),
	defaultCurrency: z.string().min(1).optional(),
});

const cartAddInput = z.object({
	token: z.string().min(1),
	productId: z.string().min(1),
	quantity: z.number().int().positive().default(1),
});

const cartSetInput = z.object({
	token: z.string().min(1),
	productId: z.string().min(1),
	quantity: z.number().int().min(0),
});

const cartClearInput = z.object({ token: z.string().min(1) });

const checkoutInput = z.object({
	token: z.string().min(1),
	email: z.string().email().optional(),
	name: z.string().optional(),
});

export function buildRoutes(opts: {
	defaultCurrency: string;
}): Record<string, PluginRoute> {
	const { defaultCurrency } = opts;

	async function config(ctx: PluginContext): Promise<CommerceConfig> {
		return (await loadEffectiveConfig(ctx, defaultCurrency)).config;
	}

	return {
		// ---- Admin: configuration --------------------------------------------
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
		"config/save": {
			input: configSaveInput,
			handler: async (ctx: RouteContext) => {
				const input = ctx.input as z.infer<typeof configSaveInput>;
				const next: CommerceConfig = {
					productsCollection: input.productsCollection,
					fieldMap: { ...DEFAULT_FIELD_MAP, ...(input.fieldMap as CommerceFieldMap) },
					defaultCurrency: input.defaultCurrency ?? defaultCurrency,
				};
				await saveConfig(ctx, next);
				ctx.log.info("Commerce config saved", {
					productsCollection: next.productsCollection,
				});
				return { configured: true, config: next };
			},
		},

		// ---- Public: live stock availability ---------------------------------
		availability: {
			public: true,
			handler: async (ctx: RouteContext) => {
				const ids = (query(ctx, "ids") ?? "")
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				const out: Record<string, { tracked: boolean; available: number | null }> = {};
				for (const id of ids) {
					const a = await getAvailability(ctx, id);
					out[id] = { tracked: a.tracked, available: a.tracked ? a.available : null };
				}
				return out;
			},
		},

		// ---- Public: cart ----------------------------------------------------
		cart: {
			public: true,
			handler: async (ctx: RouteContext) => {
				const token = query(ctx, "token");
				if (!token) return { token: null, items: [], totals: computeTotals([]) };
				const cart = await getCart(ctx, token);
				return cart
					? cartSummary(cart)
					: { token, items: [], totals: computeTotals([]) };
			},
		},
		"cart/add": {
			public: true,
			input: cartAddInput,
			handler: async (ctx: RouteContext) => {
				const input = ctx.input as z.infer<typeof cartAddInput>;
				const cfg = await config(ctx);
				const line = await buildCartItem(ctx, cfg, input.productId);
				const existing = await getCart(ctx, input.token);
				const items = mergeCartItem(existing?.items ?? [], line, input.quantity);
				const cart: Cart = {
					token: input.token,
					items,
					updatedAt: new Date().toISOString(),
				};
				await saveCart(ctx, cart);
				return cartSummary(cart);
			},
		},
		"cart/set": {
			public: true,
			input: cartSetInput,
			handler: async (ctx: RouteContext) => {
				const input = ctx.input as z.infer<typeof cartSetInput>;
				const existing = await getCart(ctx, input.token);
				const items = setCartItemQuantity(
					existing?.items ?? [],
					input.productId,
					input.quantity,
				);
				const cart: Cart = {
					token: input.token,
					items,
					updatedAt: new Date().toISOString(),
				};
				await saveCart(ctx, cart);
				return cartSummary(cart);
			},
		},
		"cart/clear": {
			public: true,
			input: cartClearInput,
			handler: async (ctx: RouteContext) => {
				const input = ctx.input as z.infer<typeof cartClearInput>;
				await deleteCart(ctx, input.token);
				return { token: input.token, items: [], totals: computeTotals([]) };
			},
		},

		// ---- Public: checkout ------------------------------------------------
		checkout: {
			public: true,
			input: checkoutInput,
			handler: async (ctx: RouteContext) => {
				const input = ctx.input as z.infer<typeof checkoutInput>;
				const cart = await getCart(ctx, input.token);
				if (!cart || cart.items.length === 0) throw badRequest("Cart is empty");

				const totals = computeTotals(cart.items);
				if (!totals.currency) throw badRequest("Cart is empty");

				const now = new Date().toISOString();
				const items = lineItemsFromCart(cart.items);
				const providerId = await loadProviderId();
				const qty = items.map((i) => ({ productId: i.productId, quantity: i.quantity }));

				let order: Order = {
					id: newOrderId(),
					status: "pending",
					items,
					currency: totals.currency,
					subtotal: totals.subtotal,
					total: totals.total,
					provider: providerId,
					customer:
						input.email || input.name
							? { email: input.email, name: input.name }
							: undefined,
					cartToken: input.token,
					history: [{ status: "pending", at: now }],
					createdAt: now,
					updatedAt: now,
				};

				// Hold stock, then move to awaiting_payment.
				try {
					await reserveItems(ctx, qty);
				} catch (err) {
					if (err instanceof InsufficientStockError) {
						throw new PluginRouteError("OUT_OF_STOCK", err.message, 409);
					}
					throw err;
				}
				order = transition(order, "awaiting_payment", now, "checkout");
				await saveOrder(ctx, order);

				const provider = getProvider(providerId);
				const returnUrl = ctx.url(`/checkout/success?order=${order.id}`);
				const cancelUrl = ctx.url(`/checkout/cancel?order=${order.id}`);
				try {
					const checkout = await provider.createCheckout({
						order,
						ctx,
						returnUrl,
						cancelUrl,
					});
					order = {
						...order,
						providerCheckoutId: checkout.checkoutId,
						updatedAt: new Date().toISOString(),
					};
					await saveOrder(ctx, order);
					return { orderId: order.id, redirectUrl: checkout.redirectUrl };
				} catch (err) {
					// Release the hold and cancel the order if checkout couldn't start.
					await releaseItems(ctx, qty);
					order = transition(
						order,
						"cancelled",
						new Date().toISOString(),
						"checkout failed",
					);
					await saveOrder(ctx, order);
					throw err;
				}
			},
		},

		// ---- Public: provider webhook / return ------------------------------
		webhook: {
			public: true,
			handler: async (ctx: RouteContext) => {
				const provider = await getActiveProvider();
				const result = await provider.handleWebhook({
					request: ctx.request,
					body: ctx.input,
					ctx,
				});
				const order = await getOrder(ctx, result.orderId);
				if (!order) throw notFound("Order not found");

				const qty = order.items.map((i) => ({
					productId: i.productId,
					quantity: i.quantity,
				}));
				const now = new Date().toISOString();

				if (result.outcome === "paid") {
					// Idempotent: only act while still awaiting payment.
					if (order.status === "awaiting_payment") {
						const paid = {
							...transition(order, "paid", now, "payment confirmed"),
							providerPaymentId: result.providerPaymentId,
						};
						await commitItems(ctx, qty);
						await saveOrder(ctx, paid);
						if (paid.cartToken) await deleteCart(ctx, paid.cartToken);
					}
					return { ok: true, status: "paid" };
				}

				// failed / cancelled — release the hold if still held.
				if (holdsReservation(order.status)) {
					const cancelled = transition(
						order,
						"cancelled",
						now,
						`payment ${result.outcome}`,
					);
					await releaseItems(ctx, qty);
					await saveOrder(ctx, cancelled);
				}
				return { ok: true, status: "cancelled" };
			},
		},

		// ---- Public: order lookup (success page) -----------------------------
		order: {
			public: true,
			handler: async (ctx: RouteContext) => {
				const id = query(ctx, "id");
				if (!id) throw badRequest("Missing order id");
				const order = await getOrder(ctx, id);
				if (!order) throw notFound("Order not found");
				return {
					id: order.id,
					status: order.status,
					items: order.items,
					currency: order.currency,
					subtotal: order.subtotal,
					total: order.total,
					createdAt: order.createdAt,
				};
			},
		},
	};
}
