/** Admin: orders list with detail, refund, and fulfil actions. */
import { Fragment, useEffect, useState } from "react";
import type { Order } from "../domain";
import { pluginGet, pluginPost } from "./api";
import { formatMoney, StatusBadge, ui } from "./ui";

interface OrdersResp {
	items: Order[];
	cursor?: string;
	hasMore?: boolean;
}

export function OrdersPage() {
	const [orders, setOrders] = useState<Order[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [open, setOpen] = useState<string | null>(null);

	async function refresh() {
		const r = await pluginGet<OrdersResp>("orders?limit=100");
		setOrders(r.items);
	}

	useEffect(() => {
		refresh()
			.catch((e) => setError(String(e?.message ?? e)))
			.finally(() => setLoading(false));
	}, []);

	function action(orderId: string, route: "orders/refund" | "orders/fulfill") {
		setBusy(orderId);
		setError(null);
		pluginPost(route, { orderId })
			.then(refresh)
			.catch((e) => setError(String(e?.message ?? e)))
			.finally(() => setBusy(null));
	}

	if (loading) return <p style={{ padding: 20 }}>Loading orders…</p>;

	return (
		<div style={ui.page}>
			<h1 style={{ margin: 0 }}>Orders</h1>
			{error && <div style={{ ...ui.card, borderColor: "#b3261e", color: "#b3261e" }}>{error}</div>}

			{orders.length === 0 ? (
				<p style={{ color: "#666" }}>No orders yet.</p>
			) : (
				<table style={ui.table}>
					<thead>
						<tr>
							<th style={ui.th}>Order</th>
							<th style={ui.th}>Date</th>
							<th style={ui.th}>Status</th>
							<th style={ui.th}>Total</th>
							<th style={ui.th}>Provider</th>
							<th style={ui.th}></th>
						</tr>
					</thead>
					<tbody>
						{orders.map((o) => (
							<Fragment key={o.id}>
								<tr>
									<td style={ui.td}>
										<button
											style={{ ...ui.btnGhost, fontFamily: "monospace" }}
											onClick={() => setOpen(open === o.id ? null : o.id)}
										>
											{o.id.slice(0, 12)}…
										</button>
									</td>
									<td style={ui.td}>{new Date(o.createdAt).toLocaleString()}</td>
									<td style={ui.td}><StatusBadge status={o.status} /></td>
									<td style={ui.td}>{formatMoney(o.total, o.currency)}</td>
									<td style={ui.td}>{o.provider}</td>
									<td style={ui.td}>
										<div style={{ display: "flex", gap: 6 }}>
											{o.status === "paid" && (
												<button
													style={ui.btnGhost}
													disabled={busy === o.id}
													onClick={() => action(o.id, "orders/fulfill")}
												>
													Fulfil
												</button>
											)}
											{(o.status === "paid" || o.status === "fulfilled") && (
												<button
													style={ui.btnGhost}
													disabled={busy === o.id}
													onClick={() => action(o.id, "orders/refund")}
												>
													Refund
												</button>
											)}
										</div>
									</td>
								</tr>
								{open === o.id && (
									<tr>
										<td style={ui.td} colSpan={6}>
											<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
												{o.customer?.email && (
													<div style={{ fontSize: 13, color: "#444" }}>
														Customer: {o.customer.name ?? ""} {o.customer.email}
													</div>
												)}
												{o.items.map((it) => (
													<div key={it.productId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
														<span>{it.title} × {it.quantity}</span>
														<span>{formatMoney(it.lineTotal, o.currency)}</span>
													</div>
												))}
											</div>
										</td>
									</tr>
								)}
							</Fragment>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
