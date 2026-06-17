/** Dashboard widget: at-a-glance commerce stats. */
import { useEffect, useState } from "react";
import { pluginGet } from "./api";
import { formatMoney, StatusBadge } from "./ui";

interface Stats {
	ordersCount: number;
	paidCount: number;
	revenue: number;
	currency: string;
	lowStock: number;
	recent: Array<{ id: string; status: string; total: number; currency: string; createdAt: string }>;
}

export function DashboardWidget() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		pluginGet<Stats>("stats")
			.then(setStats)
			.catch((e) => setError(String(e?.message ?? e)));
	}, []);

	if (error) return <div style={{ color: "#b3261e" }}>{error}</div>;
	if (!stats) return <div>Loading…</div>;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
				<Metric label="Revenue" value={formatMoney(stats.revenue, stats.currency)} />
				<Metric label="Paid orders" value={String(stats.paidCount)} />
				<Metric label="Low stock" value={String(stats.lowStock)} />
			</div>
			{stats.recent.length > 0 && (
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					{stats.recent.map((o) => (
						<div
							key={o.id}
							style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}
						>
							<span style={{ fontFamily: "monospace" }}>{o.id.slice(0, 12)}…</span>
							<StatusBadge status={o.status} />
							<span>{formatMoney(o.total, o.currency)}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em" }}>
				{label}
			</div>
			<div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
		</div>
	);
}
