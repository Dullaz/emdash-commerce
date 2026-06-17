/**
 * Pure commerce domain logic — no `emdash`, `react`, storage, or I/O.
 *
 * Everything here is a pure function or a plain type so it can be unit-tested in
 * isolation and reused from any context. Money is always in **integer minor
 * units** (e.g. cents).
 */

// ===========================================================================
// Money & carts
// ===========================================================================

export interface CartItem {
	productId: string;
	slug: string;
	title: string;
	/** Unit price in minor units. */
	unitPrice: number;
	currency: string;
	quantity: number;
}

export interface Cart {
	token: string;
	items: CartItem[];
	updatedAt: string;
}

export interface CartTotals {
	currency: string | null;
	/** Sum of unitPrice * quantity, minor units. */
	subtotal: number;
	/** Final total (== subtotal for now; tax/shipping reserved for later). */
	total: number;
	/** Total quantity across all line items. */
	itemCount: number;
}

export class MixedCurrencyError extends Error {
	constructor() {
		super("All cart items must share one currency");
		this.name = "MixedCurrencyError";
	}
}

/** Compute cart totals. Throws if items mix currencies. */
export function computeTotals(items: CartItem[]): CartTotals {
	let currency: string | null = null;
	let subtotal = 0;
	let itemCount = 0;
	for (const item of items) {
		if (item.quantity <= 0) continue;
		if (currency === null) currency = item.currency;
		else if (currency !== item.currency) throw new MixedCurrencyError();
		subtotal += item.unitPrice * item.quantity;
		itemCount += item.quantity;
	}
	return { currency, subtotal, total: subtotal, itemCount };
}

/** Add a quantity of a product to a cart's items, merging by productId. Returns
 *  a new item array (does not mutate). Removes the line if quantity reaches 0. */
export function mergeCartItem(
	items: CartItem[],
	item: Omit<CartItem, "quantity">,
	quantityDelta: number,
): CartItem[] {
	const next = items.map((i) => ({ ...i }));
	const existing = next.find((i) => i.productId === item.productId);
	if (existing) {
		existing.quantity += quantityDelta;
	} else if (quantityDelta > 0) {
		next.push({ ...item, quantity: quantityDelta });
	}
	return next.filter((i) => i.quantity > 0);
}

/** Set the absolute quantity of a product in a cart (0 removes it). */
export function setCartItemQuantity(
	items: CartItem[],
	productId: string,
	quantity: number,
): CartItem[] {
	return items
		.map((i) => (i.productId === productId ? { ...i, quantity } : { ...i }))
		.filter((i) => i.quantity > 0);
}

// ===========================================================================
// Inventory
// ===========================================================================

export interface InventoryRecord {
	productId: string;
	sku?: string;
	/** When false, stock is unlimited and reserve/commit are no-ops. */
	tracked: boolean;
	/** Physical/available-to-sell units. */
	onHand: number;
	/** Units held by in-flight (awaiting-payment) orders. */
	reserved: number;
	updatedAt: string;
}

export class InsufficientStockError extends Error {
	constructor(
		public productId: string,
		public requested: number,
		public available: number,
	) {
		super(
			`Insufficient stock for ${productId}: requested ${requested}, available ${available}`,
		);
		this.name = "InsufficientStockError";
	}
}

/** Units available to sell. Untracked or missing records are unlimited. */
export function availableOf(rec: InventoryRecord | null | undefined): number {
	if (!rec || !rec.tracked) return Number.POSITIVE_INFINITY;
	return Math.max(0, rec.onHand - rec.reserved);
}

export function canReserve(
	rec: InventoryRecord | null | undefined,
	qty: number,
): boolean {
	return qty <= availableOf(rec);
}

/** Reserve `qty` units. No-op for untracked stock. Throws if insufficient. */
export function reserve(
	rec: InventoryRecord,
	qty: number,
	now = new Date().toISOString(),
): InventoryRecord {
	if (!rec.tracked || qty <= 0) return rec;
	const available = availableOf(rec);
	if (available < qty) {
		throw new InsufficientStockError(rec.productId, qty, available);
	}
	return { ...rec, reserved: rec.reserved + qty, updatedAt: now };
}

/** Release a previously-held reservation (e.g. on cancel/expiry). */
export function release(
	rec: InventoryRecord,
	qty: number,
	now = new Date().toISOString(),
): InventoryRecord {
	if (!rec.tracked || qty <= 0) return rec;
	return { ...rec, reserved: Math.max(0, rec.reserved - qty), updatedAt: now };
}

/** Commit a reservation on payment: consume both reserved and on-hand units. */
export function commit(
	rec: InventoryRecord,
	qty: number,
	now = new Date().toISOString(),
): InventoryRecord {
	if (!rec.tracked || qty <= 0) return rec;
	return {
		...rec,
		onHand: Math.max(0, rec.onHand - qty),
		reserved: Math.max(0, rec.reserved - qty),
		updatedAt: now,
	};
}

// ===========================================================================
// Orders
// ===========================================================================

export type OrderStatus =
	| "pending"
	| "awaiting_payment"
	| "paid"
	| "fulfilled"
	| "cancelled"
	| "refunded"
	| "expired";

export interface OrderLineItem {
	productId: string;
	slug: string;
	title: string;
	unitPrice: number;
	quantity: number;
	/** unitPrice * quantity, minor units. */
	lineTotal: number;
}

export interface OrderCustomer {
	email?: string;
	name?: string;
}

export interface OrderStatusEvent {
	status: OrderStatus;
	at: string;
	note?: string;
}

export interface Order {
	id: string;
	status: OrderStatus;
	items: OrderLineItem[];
	currency: string;
	subtotal: number;
	total: number;
	/** Payment provider id (e.g. "mock", "rootline"). */
	provider: string;
	providerCheckoutId?: string;
	providerPaymentId?: string;
	customer?: OrderCustomer;
	/** Cart token the order was created from. */
	cartToken?: string;
	history: OrderStatusEvent[];
	createdAt: string;
	updatedAt: string;
}

/** Allowed status transitions. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
	pending: ["awaiting_payment", "cancelled"],
	awaiting_payment: ["paid", "cancelled", "expired"],
	paid: ["fulfilled", "refunded"],
	fulfilled: ["refunded"],
	cancelled: [],
	refunded: [],
	expired: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
	return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses where the order still holds an inventory reservation. */
export function holdsReservation(status: OrderStatus): boolean {
	return status === "pending" || status === "awaiting_payment";
}

export class InvalidTransitionError extends Error {
	constructor(
		public from: OrderStatus,
		public to: OrderStatus,
	) {
		super(`Invalid order transition: ${from} → ${to}`);
		this.name = "InvalidTransitionError";
	}
}

/** Apply a status transition, returning a new order. Throws if not allowed. */
export function transition(
	order: Order,
	to: OrderStatus,
	now = new Date().toISOString(),
	note?: string,
): Order {
	if (!canTransition(order.status, to)) {
		throw new InvalidTransitionError(order.status, to);
	}
	return {
		...order,
		status: to,
		updatedAt: now,
		history: [...order.history, { status: to, at: now, note }],
	};
}

/** Build order line items from cart items. */
export function lineItemsFromCart(items: CartItem[]): OrderLineItem[] {
	return items
		.filter((i) => i.quantity > 0)
		.map((i) => ({
			productId: i.productId,
			slug: i.slug,
			title: i.title,
			unitPrice: i.unitPrice,
			quantity: i.quantity,
			lineTotal: i.unitPrice * i.quantity,
		}));
}
