/** Admin: per-product stock levels. Toggle tracking and set on-hand units. */
import { useEffect, useState } from "react";
import { pluginGet, pluginPost } from "./api";
import { ui } from "./ui";

interface InvRow {
	productId: string;
	slug: string | null;
	title: string;
	sku?: string;
	tracked: boolean;
	onHand: number | null;
	reserved: number;
	available: number | null;
}

export function InventoryPage() {
	const [rows, setRows] = useState<InvRow[]>([]);
	const [edits, setEdits] = useState<Record<string, { tracked: boolean; onHand: number }>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	async function refresh() {
		const r = await pluginGet<{ items: InvRow[] }>("inventory");
		setRows(r.items);
		setEdits(
			Object.fromEntries(
				r.items.map((it) => [it.productId, { tracked: it.tracked, onHand: it.onHand ?? 0 }]),
			),
		);
	}

	useEffect(() => {
		refresh()
			.catch((e) => setError(String(e?.message ?? e)))
			.finally(() => setLoading(false));
	}, []);

	function save(row: InvRow) {
		const edit = edits[row.productId];
		setBusy(row.productId);
		setError(null);
		pluginPost("inventory/set", {
			productId: row.productId,
			onHand: edit.onHand,
			tracked: edit.tracked,
			sku: row.sku,
		})
			.then(refresh)
			.catch((e) => setError(String(e?.message ?? e)))
			.finally(() => setBusy(null));
	}

	if (loading) return <p style={{ padding: 20 }}>Loading inventory…</p>;

	return (
		<div style={ui.page}>
			<h1 style={{ margin: 0 }}>Inventory</h1>
			<p style={{ margin: 0, color: "#666" }}>
				Untracked products sell without limit. Enable tracking to enforce stock.
			</p>
			{error && <div style={{ ...ui.card, borderColor: "#b3261e", color: "#b3261e" }}>{error}</div>}

			<table style={ui.table}>
				<thead>
					<tr>
						<th style={ui.th}>Product</th>
						<th style={ui.th}>SKU</th>
						<th style={ui.th}>Tracked</th>
						<th style={ui.th}>On hand</th>
						<th style={ui.th}>Reserved</th>
						<th style={ui.th}>Available</th>
						<th style={ui.th}></th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const edit = edits[row.productId] ?? { tracked: row.tracked, onHand: row.onHand ?? 0 };
						return (
							<tr key={row.productId}>
								<td style={ui.td}>{row.title}</td>
								<td style={ui.td}>{row.sku ?? "—"}</td>
								<td style={ui.td}>
									<input
										type="checkbox"
										checked={edit.tracked}
										onChange={(e) =>
											setEdits((m) => ({
												...m,
												[row.productId]: { ...edit, tracked: e.target.checked },
											}))
										}
									/>
								</td>
								<td style={ui.td}>
									<input
										style={ui.input}
										type="number"
										min={0}
										disabled={!edit.tracked}
										value={edit.onHand}
										onChange={(e) =>
											setEdits((m) => ({
												...m,
												[row.productId]: { ...edit, onHand: Number(e.target.value) || 0 },
											}))
										}
									/>
								</td>
								<td style={ui.td}>{row.reserved}</td>
								<td style={ui.td}>{row.available ?? "∞"}</td>
								<td style={ui.td}>
									<button style={ui.btn} disabled={busy === row.productId} onClick={() => save(row)}>
										{busy === row.productId ? "Saving…" : "Save"}
									</button>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
