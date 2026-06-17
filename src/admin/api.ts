/**
 * Thin wrapper around the admin's authenticated `apiFetch` for calling this
 * plugin's own routes, unwrapping the `{ success, data }` envelope that the
 * EmDash plugin-route runner returns.
 */
import { apiFetch } from "@emdash-cms/admin";
import { API_BASE } from "../constants";

async function unwrap<T>(res: Response): Promise<T> {
	const json = (await res.json().catch(() => null)) as
		| { success?: boolean; data?: unknown; error?: unknown }
		| null;
	if (!res.ok || (json && json.success === false)) {
		const err = json?.error as { message?: string } | string | undefined;
		const message =
			(typeof err === "object" ? err?.message : err) ??
			`Request failed (${res.status})`;
		throw new Error(message);
	}
	return (json && "data" in json ? json.data : json) as T;
}

export async function pluginGet<T>(route: string): Promise<T> {
	return unwrap<T>(await apiFetch(`${API_BASE}/${route}`));
}

export async function pluginPost<T>(route: string, body: unknown): Promise<T> {
	return unwrap<T>(
		await apiFetch(`${API_BASE}/${route}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}
