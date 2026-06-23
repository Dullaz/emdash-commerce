/**
 * Store notifications panel.
 *
 * Lets an admin set the store-owner address that receives ecommerce alerts and
 * toggle which events trigger them (new orders, refund requests). Persisted via
 * the plugin's `config/notifications` route. Delivery still depends on an active
 * email transport configured under Settings → Email.
 */
import { useEffect, useState } from "react";
import type { CommerceConfig } from "../constants";
import { pluginGet, pluginPost } from "./api";

interface ConfigResp {
	config: CommerceConfig;
}

const ui = {
	page: { maxWidth: 640, display: "flex", flexDirection: "column", gap: 20 } as const,
	card: {
		border: "1px solid var(--border, #e2e2e2)",
		borderRadius: 10,
		padding: 20,
		display: "flex",
		flexDirection: "column",
		gap: 14,
	} as const,
	row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" } as const,
	label: { fontSize: 13, fontWeight: 600 } as const,
	input: {
		padding: "8px 10px",
		borderRadius: 8,
		border: "1px solid var(--border, #ccc)",
		fontSize: 14,
		minWidth: 260,
	} as const,
	toggle: { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 } as const,
	btn: {
		padding: "8px 14px",
		borderRadius: 8,
		border: "1px solid var(--border, #ccc)",
		background: "var(--accent, #111)",
		color: "#fff",
		fontSize: 14,
		fontWeight: 600,
		cursor: "pointer",
	} as const,
};

export function NotificationsPage() {
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const [email, setEmail] = useState("");
	const [onPurchase, setOnPurchase] = useState(true);
	const [onRefundRequest, setOnRefundRequest] = useState(true);

	function apply(config: CommerceConfig) {
		setEmail(config.notifications.email ?? "");
		setOnPurchase(config.notifications.onPurchase);
		setOnRefundRequest(config.notifications.onRefundRequest);
	}

	useEffect(() => {
		pluginGet<ConfigResp>("config")
			.then((c) => apply(c.config))
			.catch((e) => setError(String(e?.message ?? e)))
			.finally(() => setLoading(false));
	}, []);

	function handleSave() {
		setBusy(true);
		setError(null);
		setNotice(null);
		pluginPost<ConfigResp>("config/notifications", {
			email: email.trim(),
			onPurchase,
			onRefundRequest,
		})
			.then((saved) => {
				apply(saved.config);
				setNotice("Notification settings saved.");
			})
			.catch((e) => setError(String(e?.message ?? e)))
			.finally(() => setBusy(false));
	}

	if (loading) return <p style={{ padding: 20 }}>Loading notifications…</p>;

	const disabled = !email.trim();

	return (
		<div style={ui.page}>
			<div>
				<h1 style={{ margin: "0 0 4px" }}>Notifications</h1>
				<p style={{ margin: 0, color: "#666" }}>
					Email the store owner about ecommerce events. Requires an active email
					transport under <strong>Settings → Email</strong>.
				</p>
			</div>

			{error && (
				<div style={{ ...ui.card, borderColor: "#b3261e", color: "#b3261e" }}>
					{error}
				</div>
			)}
			{notice && (
				<div style={{ ...ui.card, borderColor: "#1a7f3c", color: "#1a7f3c" }}>
					{notice}
				</div>
			)}

			<div style={ui.card}>
				<label style={ui.label}>
					Notification email
					<br />
					<input
						style={ui.input}
						type="email"
						placeholder="owner@example.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
				</label>
				<p style={{ margin: 0, color: "#666", fontSize: 13 }}>
					Leave blank to turn off all owner notifications.
				</p>

				<label style={{ ...ui.toggle, opacity: disabled ? 0.5 : 1 }}>
					<input
						type="checkbox"
						checked={onPurchase}
						disabled={disabled}
						onChange={(e) => setOnPurchase(e.target.checked)}
					/>
					<span>
						<strong>Email on purchases</strong>
						<br />
						<span style={{ color: "#666", fontSize: 13 }}>
							Notify the owner when an order is paid.
						</span>
					</span>
				</label>

				<label style={{ ...ui.toggle, opacity: disabled ? 0.5 : 1 }}>
					<input
						type="checkbox"
						checked={onRefundRequest}
						disabled={disabled}
						onChange={(e) => setOnRefundRequest(e.target.checked)}
					/>
					<span>
						<strong>Email on refund requests</strong>
						<br />
						<span style={{ color: "#666", fontSize: 13 }}>
							Notify the owner when a customer requests a refund.
						</span>
					</span>
				</label>

				<div style={ui.row}>
					<button style={ui.btn} onClick={handleSave} disabled={busy} type="button">
						{busy ? "Saving…" : "Save notifications"}
					</button>
				</div>
			</div>
		</div>
	);
}
