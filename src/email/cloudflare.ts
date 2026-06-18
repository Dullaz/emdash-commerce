/**
 * Cloudflare email transport — the `email:deliver` hook implementation.
 *
 * Plugin context can't access the Cloudflare `send_email` Worker binding, so we
 * send through the Email Sending **REST API** via `ctx.http.fetch`. Credentials
 * (account id, API token, from address/name) come from encrypted plugin
 * settings. If unconfigured, delivery throws a clear error; callers that send
 * "nice to have" mail (e.g. order confirmations) should catch it.
 */
import { getPluginSetting } from "emdash";
import type { PluginContext } from "emdash";
import { PLUGIN_ID } from "../constants";

interface EmailConfig {
	accountId: string;
	apiToken: string;
	fromEmail: string;
	fromName?: string;
}

/** Read the Cloudflare email settings, or null if not fully configured. */
export async function loadEmailConfig(): Promise<EmailConfig | null> {
	const [accountId, apiToken, fromEmail, fromName] = await Promise.all([
		getPluginSetting<string>(PLUGIN_ID, "cfAccountId"),
		getPluginSetting<string>(PLUGIN_ID, "cfApiToken"),
		getPluginSetting<string>(PLUGIN_ID, "fromEmail"),
		getPluginSetting<string>(PLUGIN_ID, "fromName"),
	]);
	if (!accountId || !apiToken || !fromEmail) return null;
	return { accountId, apiToken, fromEmail, fromName: fromName || undefined };
}

export interface DeliverEvent {
	message: { to: string; subject: string; text: string; html?: string };
	source?: string;
}

/** `email:deliver` handler — sends the message via Cloudflare Email Sending. */
export async function deliverViaCloudflare(
	event: DeliverEvent,
	ctx: PluginContext,
): Promise<void> {
	const cfg = await loadEmailConfig();
	if (!cfg) {
		throw new Error(
			"Email is not configured — set the Cloudflare account id, API token and from address in the plugin settings.",
		);
	}
	if (!ctx.http) throw new Error("Email transport has no network access");

	const { message } = event;
	const res = await ctx.http.fetch(
		`https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/email/sending/send`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${cfg.apiToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				to: message.to,
				from: cfg.fromName
					? { address: cfg.fromEmail, name: cfg.fromName }
					: cfg.fromEmail,
				subject: message.subject,
				text: message.text,
				...(message.html ? { html: message.html } : {}),
			}),
		},
	);

	if (!res.ok) {
		let detail = `HTTP ${res.status}`;
		try {
			const body = (await res.json()) as { errors?: Array<{ message?: string }> };
			if (body?.errors?.length) {
				detail = body.errors.map((e) => e.message).filter(Boolean).join("; ");
			}
		} catch {
			// non-JSON error body — keep the status code
		}
		throw new Error(`Cloudflare email send failed: ${detail}`);
	}

	ctx.log.info("Email delivered", {
		to: message.to,
		subject: message.subject,
		source: event.source,
	});
}
