/**
 * Plugin API routes. Storefront-facing routes (cart, checkout, webhook, order,
 * availability) are `public`; configuration routes are admin-only.
 */
import { z } from "astro/zod";
import type { PluginContext, PluginRoute, RouteContext } from "emdash";
import {
	DEFAULT_FIELD_MAP,
	PLUGIN_ID,
	defaultNotifications,
	type CommerceConfig,
	type CommerceFieldMap,
} from "./constants";
import { loadEffectiveConfig, loadStoredConfig, saveConfig } from "./config";
import { passwordProblem, verifyPassword } from "./auth";
import {
	consumeAnyToken,
	createCustomer,
	createOneTimeToken,
	createSession,
	deleteSession,
	getCustomer,
	getSession,
	markEmailVerified,
	publicCustomer,
	setCustomerPassword,
} from "./customers";
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
} from "./email/templates";
import {
	CommerceError,
	computeTotals,
	holdsReservation,
	InsufficientStockError,
	lineItemsFromCart,
	mergeCartItem,
	normalizeEmail,
	setCartItemQuantity,
	transition,
	type Cart,
	type CartItem,
	type Order,
	type OrderStatus,
} from "./domain";
import { getActiveProvider, getProvider, loadProviderId } from "./payments";
import { clientIp, enforceRateLimit } from "./rateLimit";
import {
	commitItems,
	deleteCart,
	getAvailability,
	getInventory,
	getCart,
	getOrder,
	listInventory,
	listOrders,
	releaseItems,
	reserveItems,
	restockItems,
	listOrdersByEmail,
	saveCart,
	saveOrder,
	setStock,
} from "./store";

function query(ctx: RouteContext, key: string): string | null {
	return new URL(ctx.request.url).searchParams.get(key);
}

const badRequest = (message: string) => new CommerceError("BAD_REQUEST", message, 400);
const notFound = (message: string) => new CommerceError("NOT_FOUND", message, 404);

/**
 * Wrap every handler so an expected `CommerceError` becomes an in-band result
 * (`{ __commerceError }`) instead of a thrown error. The plugin runner only
 * passes through its own `PluginRouteError` (which Vite may duplicate, breaking
 * `instanceof`), so anything else would surface as a masked 500. Clients
 * (`lib/commerce.ts`, `admin/api.ts`) detect `__commerceError` and throw.
 */
function wrapHandlers(
	routes: Record<string, PluginRoute>,
): Record<string, PluginRoute> {
	const out: Record<string, PluginRoute> = {};
	for (const [name, route] of Object.entries(routes)) {
		out[name] = {
			...route,
			handler: async (ctx: RouteContext) => {
				try {
					return await route.handler(ctx);
				} catch (err) {
					if (err instanceof CommerceError) {
						return { __commerceError: { code: err.code, message: err.message } };
					}
					throw err;
				}
			},
		};
	}
	return out;
}

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

/** Customer-safe view of an order (no internal provider/cart fields). */
export function sanitizeOrder(o: Order) {
	return {
		id: o.id,
		status: o.status,
		items: o.items,
		currency: o.currency,
		subtotal: o.subtotal,
		total: o.total,
		createdAt: o.createdAt,
		history: o.history,
		refund: o.refund ?? null,
		customerName: o.customer?.name ?? null,
	};
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

const notificationsSaveInput = z.object({
	// Empty string clears the address; otherwise it must be a valid email.
	email: z.union([z.string().email(), z.literal("")]),
	onPurchase: z.boolean(),
	onRefundRequest: z.boolean(),
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
	email: z.string().email(),
	name: z.string().optional(),
});

const orderLookupInput = z.object({
	orderId: z.string().min(1),
	email: z.string().email(),
});

const refundRequestInput = z.object({
	orderId: z.string().min(1),
	email: z.string().email(),
	reason: z.string().max(1000).optional(),
});

const registerInput = z.object({
	email: z.string().email(),
	password: z.string().min(1),
	name: z.string().optional(),
});
const loginInput = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});
const logoutInput = z.object({ token: z.string().min(1) });
const emailOnlyInput = z.object({ email: z.string().email() });
const consumeInput = z.object({ token: z.string().min(1) });
const resetInput = z.object({
	token: z.string().min(1),
	password: z.string().min(1),
});

const orderIdInput = z.object({ orderId: z.string().min(1) });

const inventorySetInput = z.object({
	productId: z.string().min(1),
	onHand: z.number().int().min(0).default(0),
	tracked: z.boolean().optional(),
	sku: z.string().optional(),
});

export function buildRoutes(opts: {
	defaultCurrency: string;
}): Record<string, PluginRoute> {
	const { defaultCurrency } = opts;

	async function config(ctx: PluginContext): Promise<CommerceConfig> {
		return (await loadEffectiveConfig(ctx, defaultCurrency)).config;
	}

	const routes: Record<string, PluginRoute> = {
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
				const stored = await loadStoredConfig(ctx);
				const next: CommerceConfig = {
					productsCollection: input.productsCollection,
					fieldMap: { ...DEFAULT_FIELD_MAP, ...(input.fieldMap as CommerceFieldMap) },
					defaultCurrency: input.defaultCurrency ?? defaultCurrency,
					// Preserve any previously-set notification preferences.
					notifications: { ...defaultNotifications(), ...stored?.notifications },
				};
				await saveConfig(ctx, next);
				ctx.log.info("Commerce config saved", {
					productsCollection: next.productsCollection,
				});
				return { configured: true, config: next };
			},
		},
		"config/notifications": {
			input: notificationsSaveInput,
			handler: async (ctx: RouteContext) => {
				const input = ctx.input as z.infer<typeof notificationsSaveInput>;
				const effective = await loadEffectiveConfig(ctx, defaultCurrency);
				const next: CommerceConfig = {
					...effective.config,
					notifications: {
						email: input.email || null,
						onPurchase: input.onPurchase,
						onRefundRequest: input.onRefundRequest,
					},
				};
				await saveConfig(ctx, next);
				ctx.log.info("Commerce notifications saved", {
					set: !!next.notifications.email,
					onPurchase: next.notifications.onPurchase,
					onRefundRequest: next.notifications.onRefundRequest,
				});
				return { config: next };
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
					customer: { email: input.email, name: input.name },
					email: normalizeEmail(input.email),
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
						throw new CommerceError("OUT_OF_STOCK", err.message, 409);
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
						// Send the confirmation email (best-effort — never fail the
						// webhook if email is unconfigured or the provider errors).
						if (ctx.email && paid.email) {
							try {
								await ctx.email.send(
									orderConfirmationEmail({
										to: paid.email,
										order: paid,
										lookupUrl: ctx.url("/orders/lookup"),
									}),
								);
							} catch (err) {
								ctx.log.warn("Order confirmation email failed", {
									orderId: paid.id,
									error: String(err),
								});
							}
						}
						// Notify the store owner of the new order, if enabled.
						const cfg = await config(ctx);
						if (
							ctx.email &&
							cfg.notifications.email &&
							cfg.notifications.onPurchase
						) {
							try {
								await ctx.email.send(
									newOrderAdminEmail({
										to: cfg.notifications.email,
										order: paid,
										customerEmail: paid.email,
										reviewUrl: ctx.url(
											`/_emdash/admin/plugins/${PLUGIN_ID}/orders`,
										),
									}),
								);
							} catch (err) {
								ctx.log.warn("New-order admin notification failed", {
									orderId: paid.id,
									error: String(err),
								});
							}
						}
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

		// ---- Public: order by id (success page, just-placed order) -----------
		order: {
			public: true,
			handler: async (ctx: RouteContext) => {
				const id = query(ctx, "id");
				if (!id) throw badRequest("Missing order id");
				const order = await getOrder(ctx, id);
				if (!order) throw notFound("Order not found");
				return sanitizeOrder(order);
			},
		},

		// ---- Public: guest order lookup (code + email) -----------------------
		"orders/lookup": {
			public: true,
			input: orderLookupInput,
			handler: async (ctx: RouteContext) => {
				const { orderId, email } = ctx.input as z.infer<typeof orderLookupInput>;
				await enforceRateLimit(ctx, "lookup", [
					{ scope: "ip", id: clientIp(ctx), limit: 20, windowSec: 900 },
					{ scope: "email", id: normalizeEmail(email), limit: 12, windowSec: 900 },
				]);
				const order = await getOrder(ctx, orderId);
				if (!order || order.email !== normalizeEmail(email)) {
					// Same response whether the id is wrong or the email mismatches,
					// so an attacker can't probe which order ids exist.
					throw notFound("No order found for that code and email");
				}
				return sanitizeOrder(order);
			},
		},

		// ---- Public: request a refund (customer → admin approves) ------------
		"orders/request-refund": {
			public: true,
			input: refundRequestInput,
			handler: async (ctx: RouteContext) => {
				const { orderId, email, reason } = ctx.input as z.infer<
					typeof refundRequestInput
				>;
				const order = await getOrder(ctx, orderId);
				if (!order || order.email !== normalizeEmail(email)) {
					throw notFound("No order found for that code and email");
				}
				if (order.status !== "paid" && order.status !== "fulfilled") {
					throw badRequest("Only paid orders can be refunded");
				}
				const updated: Order = {
					...order,
					refund: {
						requested: true,
						reason: reason?.trim() || undefined,
						requestedAt: new Date().toISOString(),
					},
					updatedAt: new Date().toISOString(),
				};
				await saveOrder(ctx, updated);
				ctx.log.info("Refund requested", { orderId });
				// Acknowledge the request by email (best-effort).
				if (ctx.email && updated.email) {
					try {
						await ctx.email.send(
							refundRequestedEmail({
								to: updated.email,
								order: updated,
								reason: updated.refund?.reason,
							}),
						);
					} catch (err) {
						ctx.log.warn("Refund-requested email failed", {
							orderId,
							error: String(err),
						});
					}
				}
				// Notify the store owner, if enabled + configured (best-effort).
				const cfg = await config(ctx);
				if (
					ctx.email &&
					cfg.notifications.email &&
					cfg.notifications.onRefundRequest &&
					updated.email
				) {
					try {
						await ctx.email.send(
							refundRequestAdminEmail({
								to: cfg.notifications.email,
								order: updated,
								customerEmail: updated.email,
								reason: updated.refund?.reason,
								reviewUrl: ctx.url(
									`/_emdash/admin/plugins/${PLUGIN_ID}/orders`,
								),
							}),
						);
					} catch (err) {
						ctx.log.warn("Refund-request admin notification failed", {
							orderId,
							error: String(err),
						});
					}
				}
				return sanitizeOrder(updated);
			},
		},

		// ---- Public: customer accounts ---------------------------------------
		"account/register": {
			public: true,
			input: registerInput,
			handler: async (ctx: RouteContext) => {
				const input = ctx.input as z.infer<typeof registerInput>;
				await enforceRateLimit(ctx, "register", [
					{ scope: "ip", id: clientIp(ctx), limit: 10, windowSec: 3600 },
					{ scope: "email", id: normalizeEmail(input.email), limit: 5, windowSec: 3600 },
				]);
				const problem = passwordProblem(input.password);
				if (problem) throw badRequest(problem);
				let customer;
				try {
					customer = await createCustomer(ctx, {
						email: input.email,
						password: input.password,
						name: input.name,
					});
				} catch (err) {
					if (err instanceof Error && err.message === "CUSTOMER_EXISTS") {
						throw badRequest("An account with that email already exists");
					}
					throw err;
				}
				const session = await createSession(ctx, customer.email);
				// Best-effort email verification link.
				if (ctx.email) {
					try {
						const token = await createOneTimeToken(ctx, customer.email, "verify");
						await ctx.email.send(
							verifyEmail({
								to: customer.email,
								url: ctx.url(`/account/verify?token=${token}`),
							}),
						);
					} catch (err) {
						ctx.log.warn("Verification email failed", { error: String(err) });
					}
				}
				return { sessionToken: session.token, customer: publicCustomer(customer) };
			},
		},
		"account/login": {
			public: true,
			input: loginInput,
			handler: async (ctx: RouteContext) => {
				const input = ctx.input as z.infer<typeof loginInput>;
				await enforceRateLimit(ctx, "login", [
					{ scope: "ip", id: clientIp(ctx), limit: 20, windowSec: 900 },
					{ scope: "email", id: normalizeEmail(input.email), limit: 8, windowSec: 900 },
				]);
				const customer = await getCustomer(ctx, input.email);
				if (
					!customer?.passwordHash ||
					!(await verifyPassword(input.password, customer.passwordHash))
				) {
					throw badRequest("Invalid email or password");
				}
				const session = await createSession(ctx, customer.email);
				return { sessionToken: session.token, customer: publicCustomer(customer) };
			},
		},
		"account/logout": {
			public: true,
			input: logoutInput,
			handler: async (ctx: RouteContext) => {
				const { token } = ctx.input as z.infer<typeof logoutInput>;
				await deleteSession(ctx, token);
				return { ok: true };
			},
		},
		"account/me": {
			public: true,
			handler: async (ctx: RouteContext) => {
				const session = await getSession(ctx, query(ctx, "token"));
				if (!session) return { customer: null, orders: [] };
				const customer = await getCustomer(ctx, session.email);
				if (!customer) return { customer: null, orders: [] };
				const orders = await listOrdersByEmail(ctx, session.email);
				return {
					customer: publicCustomer(customer),
					orders: orders.map(sanitizeOrder),
				};
			},
		},
		"account/magic": {
			public: true,
			input: emailOnlyInput,
			handler: async (ctx: RouteContext) => {
				const { email } = ctx.input as z.infer<typeof emailOnlyInput>;
				await enforceRateLimit(ctx, "magic", [
					{ scope: "ip", id: clientIp(ctx), limit: 10, windowSec: 900 },
					{ scope: "email", id: normalizeEmail(email), limit: 4, windowSec: 900 },
				]);
				// Email a one-time sign-in link. Always succeed (never reveal whether
				// an account exists). Consuming the link creates the account if needed.
				const token = await createOneTimeToken(ctx, email, "login");
				if (ctx.email) {
					try {
						await ctx.email.send(
							magicLinkEmail({
								to: email,
								url: ctx.url(`/account/verify?token=${token}`),
							}),
						);
					} catch (err) {
						ctx.log.warn("Magic-link email failed", { error: String(err) });
					}
				}
				return { ok: true };
			},
		},
		"account/consume": {
			public: true,
			input: consumeInput,
			handler: async (ctx: RouteContext) => {
				const { token } = ctx.input as z.infer<typeof consumeInput>;
				const result = await consumeAnyToken(ctx, token);
				if (!result || result.purpose === "reset") {
					throw badRequest("This link is invalid or has expired");
				}
				// Magic-link login creates the account on first use; verify just
				// confirms the email. Either way we sign the customer in.
				let customer = await getCustomer(ctx, result.email);
				if (!customer) {
					customer = await createCustomer(ctx, {
						email: result.email,
						emailVerified: true,
					});
				} else if (!customer.emailVerified) {
					await markEmailVerified(ctx, result.email);
					customer = await getCustomer(ctx, result.email);
				}
				const session = await createSession(ctx, result.email);
				return {
					purpose: result.purpose,
					sessionToken: session.token,
					customer: customer ? publicCustomer(customer) : null,
				};
			},
		},
		"account/reset-request": {
			public: true,
			input: emailOnlyInput,
			handler: async (ctx: RouteContext) => {
				const { email } = ctx.input as z.infer<typeof emailOnlyInput>;
				await enforceRateLimit(ctx, "reset", [
					{ scope: "ip", id: clientIp(ctx), limit: 10, windowSec: 900 },
					{ scope: "email", id: normalizeEmail(email), limit: 4, windowSec: 900 },
				]);
				// Only email if the account exists, but always return ok (no leak).
				const customer = await getCustomer(ctx, email);
				if (customer && ctx.email) {
					try {
						const token = await createOneTimeToken(ctx, email, "reset");
						await ctx.email.send(
							passwordResetEmail({
								to: email,
								url: ctx.url(`/account/reset?token=${token}`),
							}),
						);
					} catch (err) {
						ctx.log.warn("Password-reset email failed", { error: String(err) });
					}
				}
				return { ok: true };
			},
		},
		"account/reset": {
			public: true,
			input: resetInput,
			handler: async (ctx: RouteContext) => {
				const { token, password } = ctx.input as z.infer<typeof resetInput>;
				const problem = passwordProblem(password);
				if (problem) throw badRequest(problem);
				const result = await consumeAnyToken(ctx, token);
				if (!result || result.purpose !== "reset") {
					throw badRequest("This link is invalid or has expired");
				}
				await setCustomerPassword(ctx, result.email, password);
				const session = await createSession(ctx, result.email);
				const customer = await getCustomer(ctx, result.email);
				return {
					sessionToken: session.token,
					customer: customer ? publicCustomer(customer) : null,
				};
			},
		},

		// ---- Admin: orders ---------------------------------------------------
		orders: {
			handler: async (ctx: RouteContext) => {
				const limit = Number(query(ctx, "limit") ?? 50) || 50;
				const cursor = query(ctx, "cursor") ?? undefined;
				const status = (query(ctx, "status") as OrderStatus | null) ?? undefined;
				return listOrders(ctx, { limit, cursor, status });
			},
		},
		"orders/get": {
			handler: async (ctx: RouteContext) => {
				const id = query(ctx, "id");
				if (!id) throw badRequest("Missing order id");
				const order = await getOrder(ctx, id);
				if (!order) throw notFound("Order not found");
				return order;
			},
		},
		"orders/refund": {
			input: orderIdInput,
			handler: async (ctx: RouteContext) => {
				const { orderId } = ctx.input as z.infer<typeof orderIdInput>;
				const order = await getOrder(ctx, orderId);
				if (!order) throw notFound("Order not found");
				if (order.status !== "paid" && order.status !== "fulfilled") {
					throw badRequest("Only paid orders can be refunded");
				}
				const provider = getProvider(order.provider);
				const result = await provider.refund({ order, amount: order.total, ctx });
				if (!result.refunded) throw badRequest("Provider declined the refund");
				const refunded = {
					...transition(order, "refunded", new Date().toISOString(), "refunded"),
					providerPaymentId: order.providerPaymentId,
				};
				await restockItems(
					ctx,
					order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
				);
				await saveOrder(ctx, refunded);
				// Notify the customer that their refund was approved (best-effort).
				if (ctx.email && refunded.email) {
					try {
						await ctx.email.send(
							refundApprovedEmail({ to: refunded.email, order: refunded }),
						);
					} catch (err) {
						ctx.log.warn("Refund-approved email failed", {
							orderId,
							error: String(err),
						});
					}
				}
				return { ok: true, status: "refunded" as const };
			},
		},
		"orders/fulfill": {
			input: orderIdInput,
			handler: async (ctx: RouteContext) => {
				const { orderId } = ctx.input as z.infer<typeof orderIdInput>;
				const order = await getOrder(ctx, orderId);
				if (!order) throw notFound("Order not found");
				if (order.status !== "paid") {
					throw badRequest("Only paid orders can be fulfilled");
				}
				const fulfilled = transition(
					order,
					"fulfilled",
					new Date().toISOString(),
					"fulfilled",
				);
				await saveOrder(ctx, fulfilled);
				// Let the customer know their order is on its way (best-effort).
				if (ctx.email && fulfilled.email) {
					try {
						await ctx.email.send(
							orderFulfilledEmail({
								to: fulfilled.email,
								order: fulfilled,
								lookupUrl: ctx.url("/orders/lookup"),
							}),
						);
					} catch (err) {
						ctx.log.warn("Order-fulfilled email failed", {
							orderId,
							error: String(err),
						});
					}
				}
				return { ok: true, status: "fulfilled" as const };
			},
		},

		// ---- Admin: inventory ------------------------------------------------
		inventory: {
			handler: async (ctx: RouteContext) => {
				const cfg = await config(ctx);
				if (!ctx.content || !cfg.productsCollection) return { items: [] };
				const products = await ctx.content.list(cfg.productsCollection, {
					limit: 200,
				});
				const items = [];
				for (const p of products.items) {
					const rec = await getInventory(ctx, p.id);
					items.push({
						productId: p.id,
						slug: p.slug,
						title: String(p.data[cfg.fieldMap.title] ?? p.slug ?? p.id),
						sku: rec?.sku ?? (p.data[cfg.fieldMap.sku] as string | undefined),
						tracked: rec?.tracked ?? false,
						onHand: rec?.onHand ?? null,
						reserved: rec?.reserved ?? 0,
						available: rec
							? rec.tracked
								? Math.max(0, rec.onHand - rec.reserved)
								: null
							: null,
					});
				}
				return { items };
			},
		},
		"inventory/set": {
			input: inventorySetInput,
			handler: async (ctx: RouteContext) => {
				const input = ctx.input as z.infer<typeof inventorySetInput>;
				const rec = await setStock(ctx, input.productId, input.onHand, {
					tracked: input.tracked ?? true,
					sku: input.sku,
				});
				return rec;
			},
		},

		// ---- Admin: dashboard stats ------------------------------------------
		stats: {
			handler: async (ctx: RouteContext) => {
				const { items: orders } = await listOrders(ctx, { limit: 500 });
				const revenue = orders
					.filter((o) => o.status === "paid" || o.status === "fulfilled")
					.reduce((sum, o) => sum + o.total, 0);
				const paidCount = orders.filter(
					(o) => o.status === "paid" || o.status === "fulfilled",
				).length;
				const inventory = await listInventory(ctx);
				const lowStock = inventory.filter(
					(r) => r.tracked && r.onHand - r.reserved <= 5,
				).length;
				const currency = orders.find((o) => o.currency)?.currency ?? "USD";
				return {
					ordersCount: orders.length,
					paidCount,
					revenue,
					currency,
					lowStock,
					recent: orders.slice(0, 5).map((o) => ({
						id: o.id,
						status: o.status,
						total: o.total,
						currency: o.currency,
						createdAt: o.createdAt,
					})),
				};
			},
		},
	};

	return wrapHandlers(routes);
}
