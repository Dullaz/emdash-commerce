/**
 * Storage layer — binds the pure domain logic to the plugin's document storage
 * (`ctx.storage.{inventory,carts,orders,payments}`). Type-only `emdash` import,
 * so this stays free of runtime coupling.
 */
import type { PluginContext } from "emdash";
import {
	availableOf,
	canReserve,
	commit,
	InsufficientStockError,
	release,
	reserve,
	type Cart,
	type InventoryRecord,
	type Order,
	type OrderStatus,
} from "./domain";

type QtyItem = { productId: string; quantity: number };

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export async function getInventory(
	ctx: PluginContext,
	productId: string,
): Promise<InventoryRecord | null> {
	return (await ctx.storage.inventory.get(productId)) as InventoryRecord | null;
}

export interface Availability {
	tracked: boolean;
	available: number;
	onHand?: number;
	reserved?: number;
}

export async function getAvailability(
	ctx: PluginContext,
	productId: string,
): Promise<Availability> {
	const rec = await getInventory(ctx, productId);
	if (!rec || !rec.tracked) {
		return { tracked: false, available: Number.POSITIVE_INFINITY };
	}
	return {
		tracked: true,
		available: availableOf(rec),
		onHand: rec.onHand,
		reserved: rec.reserved,
	};
}

/** Create or update a tracked stock level for a product. */
export async function setStock(
	ctx: PluginContext,
	productId: string,
	onHand: number,
	opts: { sku?: string; tracked?: boolean } = {},
): Promise<InventoryRecord> {
	const existing = await getInventory(ctx, productId);
	const rec: InventoryRecord = {
		productId,
		sku: opts.sku ?? existing?.sku,
		tracked: opts.tracked ?? true,
		onHand,
		reserved: existing?.reserved ?? 0,
		updatedAt: new Date().toISOString(),
	};
	await ctx.storage.inventory.put(productId, rec);
	return rec;
}

/**
 * Reserve stock for a set of line items. Validates every item first, then
 * writes — so an under-stocked line aborts the whole reservation rather than
 * leaving a partial hold. (Best-effort across keys; storage has no multi-key
 * transaction. Acceptable for this store's volume.)
 */
export async function reserveItems(
	ctx: PluginContext,
	items: QtyItem[],
): Promise<void> {
	const records = new Map<string, InventoryRecord | null>();
	for (const it of items) {
		records.set(it.productId, await getInventory(ctx, it.productId));
	}
	for (const it of items) {
		const rec = records.get(it.productId);
		if (rec?.tracked && !canReserve(rec, it.quantity)) {
			throw new InsufficientStockError(
				it.productId,
				it.quantity,
				availableOf(rec),
			);
		}
	}
	for (const it of items) {
		const rec = records.get(it.productId);
		if (rec?.tracked) {
			await ctx.storage.inventory.put(it.productId, reserve(rec, it.quantity));
		}
	}
}

export async function releaseItems(
	ctx: PluginContext,
	items: QtyItem[],
): Promise<void> {
	for (const it of items) {
		const rec = await getInventory(ctx, it.productId);
		if (rec?.tracked) {
			await ctx.storage.inventory.put(it.productId, release(rec, it.quantity));
		}
	}
}

export async function commitItems(
	ctx: PluginContext,
	items: QtyItem[],
): Promise<void> {
	for (const it of items) {
		const rec = await getInventory(ctx, it.productId);
		if (rec?.tracked) {
			await ctx.storage.inventory.put(it.productId, commit(rec, it.quantity));
		}
	}
}

/** Add units back to on-hand stock (e.g. after a refund) for tracked items. */
export async function restockItems(
	ctx: PluginContext,
	items: QtyItem[],
): Promise<void> {
	for (const it of items) {
		const rec = await getInventory(ctx, it.productId);
		if (rec?.tracked) {
			await ctx.storage.inventory.put(it.productId, {
				...rec,
				onHand: rec.onHand + it.quantity,
				updatedAt: new Date().toISOString(),
			});
		}
	}
}

export async function listInventory(
	ctx: PluginContext,
	limit = 200,
): Promise<InventoryRecord[]> {
	const res = await ctx.storage.inventory.query({ limit });
	return (res.items as Array<{ data: InventoryRecord }>).map((i) => i.data);
}

// ---------------------------------------------------------------------------
// Carts
// ---------------------------------------------------------------------------

export async function getCart(
	ctx: PluginContext,
	token: string,
): Promise<Cart | null> {
	return (await ctx.storage.carts.get(token)) as Cart | null;
}

export async function saveCart(ctx: PluginContext, cart: Cart): Promise<void> {
	await ctx.storage.carts.put(cart.token, {
		...cart,
		updatedAt: new Date().toISOString(),
	});
}

export async function deleteCart(
	ctx: PluginContext,
	token: string,
): Promise<void> {
	await ctx.storage.carts.delete(token);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function saveOrder(ctx: PluginContext, order: Order): Promise<void> {
	await ctx.storage.orders.put(order.id, order);
}

export async function getOrder(
	ctx: PluginContext,
	id: string,
): Promise<Order | null> {
	return (await ctx.storage.orders.get(id)) as Order | null;
}

export interface ListOrdersOpts {
	limit?: number;
	cursor?: string;
	status?: OrderStatus;
}

export async function listOrders(
	ctx: PluginContext,
	opts: ListOrdersOpts = {},
): Promise<{ items: Order[]; cursor?: string; hasMore?: boolean }> {
	const res = await ctx.storage.orders.query({
		orderBy: { createdAt: "desc" },
		limit: opts.limit ?? 50,
		cursor: opts.cursor,
		where: opts.status ? { status: opts.status } : undefined,
	});
	return {
		items: (res.items as Array<{ data: Order }>).map((i) => i.data),
		cursor: res.cursor,
		hasMore: res.hasMore,
	};
}

/** All orders for a (normalized) customer email, newest first. */
export async function listOrdersByEmail(
	ctx: PluginContext,
	email: string,
	limit = 100,
): Promise<Order[]> {
	const res = await ctx.storage.orders.query({
		where: { email },
		orderBy: { createdAt: "desc" },
		limit,
	});
	return (res.items as Array<{ data: Order }>).map((i) => i.data);
}
