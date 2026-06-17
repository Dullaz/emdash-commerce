/** Shared inline styles + small presentational helpers for the admin pages. */
import type { ReactNode } from "react";
import { formatMoney } from "../constants";

export { formatMoney };

export const ui = {
	page: {
		maxWidth: 920,
		display: "flex",
		flexDirection: "column",
		gap: 20,
	} as const,
	card: {
		border: "1px solid var(--border, #e2e2e2)",
		borderRadius: 10,
		padding: 20,
		display: "flex",
		flexDirection: "column",
		gap: 14,
	} as const,
	row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" } as const,
	input: {
		padding: "6px 8px",
		borderRadius: 8,
		border: "1px solid var(--border, #ccc)",
		fontSize: 14,
		width: 90,
	} as const,
	btn: {
		padding: "6px 12px",
		borderRadius: 8,
		border: "1px solid var(--border, #ccc)",
		background: "var(--accent, #111)",
		color: "#fff",
		fontSize: 13,
		fontWeight: 600,
		cursor: "pointer",
	} as const,
	btnGhost: {
		padding: "6px 12px",
		borderRadius: 8,
		border: "1px solid var(--border, #ccc)",
		background: "transparent",
		fontSize: 13,
		cursor: "pointer",
	} as const,
	table: { borderCollapse: "collapse", width: "100%", fontSize: 14 } as const,
	th: {
		textAlign: "left",
		padding: "8px",
		fontSize: 12,
		color: "#666",
		borderBottom: "1px solid #eee",
	} as const,
	td: { padding: "8px", borderBottom: "1px solid #f0f0f0", verticalAlign: "top" } as const,
};

const STATUS_COLORS: Record<string, [string, string]> = {
	paid: ["#e6f6ec", "#1a7f3c"],
	fulfilled: ["#e6f0ff", "#1d4ed8"],
	awaiting_payment: ["#fff6e0", "#9a6700"],
	pending: ["#f0eefb", "#5b4bff"],
	cancelled: ["#f1f1f1", "#666"],
	expired: ["#f1f1f1", "#666"],
	refunded: ["#fdecec", "#b3261e"],
};

export function StatusBadge({ status }: { status: string }) {
	const [bg, fg] = STATUS_COLORS[status] ?? ["#f1f1f1", "#444"];
	return (
		<span
			style={{
				display: "inline-block",
				fontSize: 12,
				fontWeight: 700,
				letterSpacing: "0.02em",
				padding: "2px 8px",
				borderRadius: 999,
				background: bg,
				color: fg,
			}}
		>
			{status.replace(/_/g, " ")}
		</span>
	);
}

export function StatCard({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div style={{ ...ui.card, gap: 4, flex: 1, minWidth: 140 }}>
			<span style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em" }}>
				{label}
			</span>
			<span style={{ fontSize: 26, fontWeight: 700 }}>{value}</span>
		</div>
	);
}
