/**
 * Store setup panel.
 *
 * Lets an admin either (a) create a new products collection or (b) point the
 * store at an existing collection — validating that the required commerce fields
 * are present and offering a one-click "add missing fields" action. All schema
 * operations go through the official admin client (`createCollection`,
 * `createField`, `fetchCollection`), which is authenticated as the logged-in
 * admin. The chosen collection + field mapping are persisted via the plugin's
 * own `config` route.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
	createCollection,
	createField,
	fetchCollection,
	fetchCollections,
	type SchemaCollection,
	type SchemaField,
} from "@emdash-cms/admin";
import {
	REQUIRED_FIELDS,
	type CommerceConfig,
	type CommerceFieldMap,
	type CommerceFieldRole,
} from "../constants";
import { pluginGet, pluginPost } from "./api";

interface ConfigResp {
	configured: boolean;
	config: CommerceConfig;
	defaultCurrency: string;
}

function blankMap(): CommerceFieldMap {
	return {
		title: "",
		price: "",
		currency: "",
		sku: "",
		image: "",
		description: "",
		active: "",
	};
}

function defForRole(role: CommerceFieldRole) {
	return REQUIRED_FIELDS.find((f) => f.role === role)!;
}

function isCompatible(role: CommerceFieldRole, type: string | undefined): boolean {
	if (!type) return false;
	return defForRole(role).compatibleTypes.includes(type);
}

/** Auto-pick a field slug for each role from a collection's fields. */
function autoMap(fields: SchemaField[], existing?: CommerceFieldMap): CommerceFieldMap {
	const map = blankMap();
	for (const def of REQUIRED_FIELDS) {
		const prev = existing?.[def.role];
		const prevField = prev ? fields.find((f) => f.slug === prev) : undefined;
		if (prevField && isCompatible(def.role, prevField.type)) {
			map[def.role] = prev as string;
			continue;
		}
		const byName = fields.find(
			(f) => f.slug === def.slug && isCompatible(def.role, f.type),
		);
		if (byName) {
			map[def.role] = byName.slug;
			continue;
		}
		const byType = fields.find((f) => isCompatible(def.role, f.type));
		if (byType) map[def.role] = byType.slug;
	}
	return map;
}

const ui = {
	page: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 20 } as const,
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
		minWidth: 220,
	} as const,
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
	btnGhost: {
		padding: "8px 14px",
		borderRadius: 8,
		border: "1px solid var(--border, #ccc)",
		background: "transparent",
		fontSize: 14,
		cursor: "pointer",
	} as const,
};

function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
	return (
		<span
			style={{
				fontSize: 12,
				fontWeight: 700,
				padding: "2px 8px",
				borderRadius: 999,
				background: ok ? "#e6f6ec" : "#fdecec",
				color: ok ? "#1a7f3c" : "#b3261e",
			}}
		>
			{children}
		</span>
	);
}

export function SetupPage() {
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const [resp, setResp] = useState<ConfigResp | null>(null);
	const [collections, setCollections] = useState<SchemaCollection[]>([]);
	const [mode, setMode] = useState<"create" | "existing">("create");

	const [newSlug, setNewSlug] = useState("products");
	const [newLabel, setNewLabel] = useState("Products");

	const [selectedSlug, setSelectedSlug] = useState("");
	const [fields, setFields] = useState<SchemaField[]>([]);
	const [fieldMap, setFieldMap] = useState<CommerceFieldMap>(blankMap());

	async function refresh() {
		const [c, cols] = await Promise.all([
			pluginGet<ConfigResp>("config"),
			fetchCollections(),
		]);
		setResp(c);
		setCollections(cols);
		if (c.configured && c.config.productsCollection) {
			setMode("existing");
			await selectCollection(c.config.productsCollection, c.config.fieldMap);
		}
	}

	useEffect(() => {
		refresh()
			.catch((e) => setError(String(e?.message ?? e)))
			.finally(() => setLoading(false));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function selectCollection(slug: string, existing?: CommerceFieldMap) {
		setSelectedSlug(slug);
		if (!slug) {
			setFields([]);
			setFieldMap(blankMap());
			return;
		}
		const full = await fetchCollection(slug, true);
		setFields(full.fields);
		setFieldMap(autoMap(full.fields, existing));
	}

	const validation = useMemo(() => {
		return REQUIRED_FIELDS.map((def) => {
			const slug = fieldMap[def.role];
			const field = fields.find((f) => f.slug === slug);
			const ok = !!field && isCompatible(def.role, field.type);
			return { def, slug, ok };
		});
	}, [fields, fieldMap]);

	const missingRequired = validation.filter((v) => v.def.required && !v.ok);
	const missingAny = validation.filter((v) => !v.ok);

	function run(fn: () => Promise<void>) {
		setBusy(true);
		setError(null);
		setNotice(null);
		fn()
			.catch((e) => setError(String(e?.message ?? e)))
			.finally(() => setBusy(false));
	}

	function handleCreate() {
		run(async () => {
			const slug = newSlug.trim();
			if (!/^[a-z][a-z0-9_]*$/.test(slug)) {
				throw new Error(
					"Slug must be lowercase letters, digits and underscores, starting with a letter.",
				);
			}
			await createCollection({
				slug,
				label: newLabel.trim() || slug,
				labelSingular: (newLabel.trim() || slug).replace(/s$/, ""),
				supports: ["drafts", "revisions", "search"],
				hasSeo: true,
			});
			for (const def of REQUIRED_FIELDS) {
				await createField(slug, {
					slug: def.slug,
					label: def.label,
					type: def.type as SchemaField["type"],
					required: def.required,
					searchable: def.role === "title",
				});
			}
			await pluginPost<ConfigResp>("config/save", {
				productsCollection: slug,
				fieldMap: REQUIRED_FIELDS.reduce((m, d) => {
					m[d.role] = d.slug;
					return m;
				}, blankMap()),
				defaultCurrency: resp?.defaultCurrency,
			});
			setNotice(`Created "${slug}" and connected it to the store.`);
			setLoading(true);
			await refresh().finally(() => setLoading(false));
		});
	}

	function handleAddMissing() {
		run(async () => {
			for (const v of missingAny) {
				await createField(selectedSlug, {
					slug: v.def.slug,
					label: v.def.label,
					type: v.def.type as SchemaField["type"],
					required: v.def.required,
					searchable: v.def.role === "title",
				});
			}
			await selectCollection(selectedSlug, fieldMap);
			setNotice("Added missing fields.");
		});
	}

	function handleSaveExisting() {
		run(async () => {
			if (!selectedSlug) throw new Error("Pick a collection first.");
			if (missingRequired.length > 0) {
				throw new Error(
					`Map or add the required field(s): ${missingRequired
						.map((v) => v.def.label)
						.join(", ")}`,
				);
			}
			const saved = await pluginPost<ConfigResp>("config/save", {
				productsCollection: selectedSlug,
				fieldMap,
				defaultCurrency: resp?.defaultCurrency,
			});
			setResp((r) => (r ? { ...r, ...saved } : r));
			setNotice("Store configuration saved.");
		});
	}

	if (loading) return <p style={{ padding: 20 }}>Loading store setup…</p>;

	return (
		<div style={ui.page}>
			<div>
				<h1 style={{ margin: "0 0 4px" }}>Store setup</h1>
				<p style={{ margin: 0, color: "#666" }}>
					Choose the content collection that holds your products.
				</p>
			</div>

			{resp?.configured ? (
				<div style={{ ...ui.card, borderColor: "#1a7f3c" }}>
					<div style={ui.row}>
						<Badge ok>Connected</Badge>
						<span>
							Products live in <strong>{resp.config.productsCollection}</strong>.
						</span>
					</div>
				</div>
			) : (
				<div style={{ ...ui.card, borderColor: "#c98a00" }}>
					<div style={ui.row}>
						<Badge ok={false}>Not configured</Badge>
						<span>
							The store will use a collection named{" "}
							<strong>products</strong> if it exists. Configure it below.
						</span>
					</div>
				</div>
			)}

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

			<div style={ui.row}>
				<button
					style={mode === "create" ? ui.btn : ui.btnGhost}
					onClick={() => setMode("create")}
					type="button"
				>
					Create new collection
				</button>
				<button
					style={mode === "existing" ? ui.btn : ui.btnGhost}
					onClick={() => setMode("existing")}
					type="button"
				>
					Use existing collection
				</button>
			</div>

			{mode === "create" ? (
				<div style={ui.card}>
					<h2 style={{ margin: 0 }}>Create a products collection</h2>
					<p style={{ margin: 0, color: "#666" }}>
						Creates a new collection with all required commerce fields and
						connects it to the store.
					</p>
					<div style={ui.row}>
						<label style={ui.label}>
							Slug
							<br />
							<input
								style={ui.input}
								value={newSlug}
								onChange={(e) => setNewSlug(e.target.value)}
							/>
						</label>
						<label style={ui.label}>
							Label
							<br />
							<input
								style={ui.input}
								value={newLabel}
								onChange={(e) => setNewLabel(e.target.value)}
							/>
						</label>
					</div>
					<div style={ui.row}>
						<button
							style={ui.btn}
							onClick={handleCreate}
							disabled={busy}
							type="button"
						>
							{busy ? "Creating…" : "Create & connect"}
						</button>
					</div>
					<FieldList />
				</div>
			) : (
				<div style={ui.card}>
					<h2 style={{ margin: 0 }}>Use an existing collection</h2>
					<div style={ui.row}>
						<label style={ui.label}>
							Collection
							<br />
							<select
								style={ui.input}
								value={selectedSlug}
								onChange={(e) =>
									run(async () => selectCollection(e.target.value))
								}
							>
								<option value="">— select —</option>
								{collections.map((c) => (
									<option key={c.slug} value={c.slug}>
										{c.label} ({c.slug})
									</option>
								))}
							</select>
						</label>
					</div>

					{selectedSlug && (
						<>
							<table style={{ borderCollapse: "collapse", width: "100%" }}>
								<thead>
									<tr style={{ textAlign: "left", fontSize: 12, color: "#666" }}>
										<th style={{ padding: "6px 8px" }}>Commerce field</th>
										<th style={{ padding: "6px 8px" }}>Mapped to</th>
										<th style={{ padding: "6px 8px" }}>Status</th>
									</tr>
								</thead>
								<tbody>
									{validation.map(({ def, slug, ok }) => (
										<tr key={def.role} style={{ borderTop: "1px solid #eee" }}>
											<td style={{ padding: "8px" }}>
												<strong>{def.label}</strong>
												{def.required && (
													<span style={{ color: "#b3261e" }}> *</span>
												)}
												<div style={{ fontSize: 12, color: "#777" }}>
													{def.description}
												</div>
											</td>
											<td style={{ padding: "8px" }}>
												<select
													style={{ ...ui.input, minWidth: 160 }}
													value={slug}
													onChange={(e) =>
														setFieldMap((m) => ({
															...m,
															[def.role]: e.target.value,
														}))
													}
												>
													<option value="">— none —</option>
													{fields
														.filter((f) => isCompatible(def.role, f.type))
														.map((f) => (
															<option key={f.slug} value={f.slug}>
																{f.label} ({f.slug})
															</option>
														))}
												</select>
											</td>
											<td style={{ padding: "8px" }}>
												<Badge ok={ok}>{ok ? "OK" : "Missing"}</Badge>
											</td>
										</tr>
									))}
								</tbody>
							</table>

							<div style={ui.row}>
								{missingAny.length > 0 && (
									<button
										style={ui.btnGhost}
										onClick={handleAddMissing}
										disabled={busy}
										type="button"
									>
										{busy
											? "Working…"
											: `Add ${missingAny.length} missing field(s)`}
									</button>
								)}
								<button
									style={ui.btn}
									onClick={handleSaveExisting}
									disabled={busy || missingRequired.length > 0}
									type="button"
								>
									{busy ? "Saving…" : "Save configuration"}
								</button>
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);

	function FieldList() {
		return (
			<ul style={{ margin: 0, paddingLeft: 18, color: "#555", fontSize: 13 }}>
				{REQUIRED_FIELDS.map((f) => (
					<li key={f.role}>
						<code>{f.slug}</code> — {f.label} ({f.type})
						{f.required ? " · required" : ""}
					</li>
				))}
			</ul>
		);
	}
}
