import { describe, expect, test } from "bun:test";
import {
	availableOf,
	canReserve,
	canTransition,
	commit,
	computeTotals,
	holdsReservation,
	InsufficientStockError,
	InvalidTransitionError,
	lineItemsFromCart,
	mergeCartItem,
	MixedCurrencyError,
	release,
	reserve,
	setCartItemQuantity,
	transition,
	type CartItem,
	type InventoryRecord,
	type Order,
} from "./domain";

const item = (over: Partial<CartItem> = {}): CartItem => ({
	productId: "p1",
	slug: "p1",
	title: "Product 1",
	unitPrice: 1000,
	currency: "USD",
	quantity: 1,
	...over,
});

describe("computeTotals", () => {
	test("sums line items and counts quantity", () => {
		const t = computeTotals([
			item({ unitPrice: 1000, quantity: 2 }),
			item({ productId: "p2", slug: "p2", unitPrice: 500, quantity: 3 }),
		]);
		expect(t.subtotal).toBe(1000 * 2 + 500 * 3);
		expect(t.total).toBe(t.subtotal);
		expect(t.itemCount).toBe(5);
		expect(t.currency).toBe("USD");
	});

	test("empty cart → zero, null currency", () => {
		const t = computeTotals([]);
		expect(t).toEqual({ currency: null, subtotal: 0, total: 0, itemCount: 0 });
	});

	test("ignores zero/negative quantities", () => {
		const t = computeTotals([item({ quantity: 0 }), item({ productId: "p2", quantity: 2 })]);
		expect(t.itemCount).toBe(2);
	});

	test("rejects mixed currencies", () => {
		expect(() =>
			computeTotals([item({ currency: "USD" }), item({ productId: "p2", currency: "EUR" })]),
		).toThrow(MixedCurrencyError);
	});
});

describe("cart mutation", () => {
	test("mergeCartItem adds new and increments existing", () => {
		let items: CartItem[] = [];
		items = mergeCartItem(items, item(), 2);
		expect(items).toHaveLength(1);
		expect(items[0].quantity).toBe(2);
		items = mergeCartItem(items, item(), 3);
		expect(items[0].quantity).toBe(5);
	});

	test("mergeCartItem removes line when quantity hits zero", () => {
		const items = mergeCartItem([item({ quantity: 2 })], item(), -2);
		expect(items).toHaveLength(0);
	});

	test("setCartItemQuantity sets absolute and removes on 0", () => {
		const items = [item({ quantity: 2 }), item({ productId: "p2", quantity: 1 })];
		expect(setCartItemQuantity(items, "p1", 5)[0].quantity).toBe(5);
		expect(setCartItemQuantity(items, "p1", 0).map((i) => i.productId)).toEqual(["p2"]);
	});
});

describe("inventory", () => {
	const rec = (over: Partial<InventoryRecord> = {}): InventoryRecord => ({
		productId: "p1",
		tracked: true,
		onHand: 10,
		reserved: 0,
		updatedAt: "t0",
		...over,
	});

	test("availableOf: untracked/missing is unlimited", () => {
		expect(availableOf(null)).toBe(Number.POSITIVE_INFINITY);
		expect(availableOf(rec({ tracked: false }))).toBe(Number.POSITIVE_INFINITY);
	});

	test("availableOf: tracked = onHand - reserved, floored at 0", () => {
		expect(availableOf(rec({ onHand: 10, reserved: 3 }))).toBe(7);
		expect(availableOf(rec({ onHand: 2, reserved: 5 }))).toBe(0);
	});

	test("reserve holds units and respects availability", () => {
		const r = reserve(rec({ onHand: 5, reserved: 1 }), 3, "t1");
		expect(r.reserved).toBe(4);
		expect(r.updatedAt).toBe("t1");
		expect(availableOf(r)).toBe(1);
	});

	test("reserve throws when insufficient", () => {
		expect(() => reserve(rec({ onHand: 5, reserved: 4 }), 2)).toThrow(InsufficientStockError);
	});

	test("canReserve mirrors availability; untracked always true", () => {
		expect(canReserve(rec({ onHand: 5, reserved: 4 }), 1)).toBe(true);
		expect(canReserve(rec({ onHand: 5, reserved: 4 }), 2)).toBe(false);
		expect(canReserve(null, 9999)).toBe(true);
	});

	test("release frees reservation, floored at 0", () => {
		expect(release(rec({ reserved: 3 }), 2).reserved).toBe(1);
		expect(release(rec({ reserved: 1 }), 5).reserved).toBe(0);
	});

	test("commit consumes both onHand and reserved", () => {
		const r = commit(rec({ onHand: 10, reserved: 4 }), 3);
		expect(r.onHand).toBe(7);
		expect(r.reserved).toBe(1);
	});

	test("reserve/commit are no-ops for untracked stock", () => {
		const u = rec({ tracked: false });
		expect(reserve(u, 100)).toBe(u);
		expect(commit(u, 100)).toBe(u);
	});

	test("reserve → commit reduces sellable stock by sold quantity", () => {
		let r = rec({ onHand: 10, reserved: 0 });
		r = reserve(r, 4);
		expect(availableOf(r)).toBe(6);
		r = commit(r, 4);
		expect(r.onHand).toBe(6);
		expect(availableOf(r)).toBe(6);
	});
});

describe("order state machine", () => {
	test("valid transitions", () => {
		expect(canTransition("pending", "awaiting_payment")).toBe(true);
		expect(canTransition("awaiting_payment", "paid")).toBe(true);
		expect(canTransition("awaiting_payment", "expired")).toBe(true);
		expect(canTransition("paid", "refunded")).toBe(true);
		expect(canTransition("paid", "fulfilled")).toBe(true);
	});

	test("invalid transitions", () => {
		expect(canTransition("pending", "paid")).toBe(false);
		expect(canTransition("paid", "pending")).toBe(false);
		expect(canTransition("cancelled", "paid")).toBe(false);
		expect(canTransition("refunded", "fulfilled")).toBe(false);
	});

	test("holdsReservation true only while pending/awaiting_payment", () => {
		expect(holdsReservation("pending")).toBe(true);
		expect(holdsReservation("awaiting_payment")).toBe(true);
		expect(holdsReservation("paid")).toBe(false);
		expect(holdsReservation("cancelled")).toBe(false);
	});

	const order = (status: Order["status"]): Order => ({
		id: "o1",
		status,
		items: [],
		currency: "USD",
		subtotal: 0,
		total: 0,
		provider: "mock",
		history: [],
		createdAt: "t0",
		updatedAt: "t0",
	});

	test("transition appends history and updates status", () => {
		const o = transition(order("awaiting_payment"), "paid", "t1", "webhook");
		expect(o.status).toBe("paid");
		expect(o.updatedAt).toBe("t1");
		expect(o.history).toEqual([{ status: "paid", at: "t1", note: "webhook" }]);
	});

	test("transition throws on invalid move", () => {
		expect(() => transition(order("paid"), "pending")).toThrow(InvalidTransitionError);
	});
});

describe("lineItemsFromCart", () => {
	test("maps cart items and computes line totals", () => {
		const lines = lineItemsFromCart([
			item({ unitPrice: 1000, quantity: 2 }),
			item({ productId: "p2", quantity: 0 }),
		]);
		expect(lines).toHaveLength(1);
		expect(lines[0].lineTotal).toBe(2000);
	});
});
