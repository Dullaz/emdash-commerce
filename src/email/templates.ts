/**
 * Transactional email templates — pure functions returning a message
 * (`{ to, subject, text, html }`). No I/O, so they're unit-testable.
 */
import { STORE_NAME, formatMoney } from "../constants";

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html: string;
}

interface OrderLike {
	id: string;
	currency: string;
	total: number;
	items: Array<{ title: string; quantity: number; lineTotal: number }>;
}

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Minimal, client-safe HTML shell with inline styles. */
function layout(heading: string, bodyHtml: string): string {
	return `<!doctype html><html><body style="margin:0;background:#f6f5f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16131f">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;font-size:20px;letter-spacing:-0.03em">${esc(STORE_NAME)}<span style="color:#5b4bff">.</span></div>
<div style="background:#fff;border:1px solid #e6e3da;border-radius:12px;padding:24px;margin-top:16px">
<h1 style="font-size:20px;margin:0 0 12px">${esc(heading)}</h1>
${bodyHtml}
</div>
<p style="color:#6b6678;font-size:12px;margin-top:16px">${esc(STORE_NAME)} — pixels sold by the block.</p>
</div></body></html>`;
}

export function orderConfirmationEmail(args: {
	to: string;
	order: OrderLike;
	lookupUrl?: string;
}): EmailMessage {
	const { to, order, lookupUrl } = args;
	const lines = order.items
		.map((i) => `  • ${i.title} × ${i.quantity} — ${formatMoney(i.lineTotal, order.currency)}`)
		.join("\n");
	const total = formatMoney(order.total, order.currency);
	const text =
		`Thanks for your order!\n\nOrder ${order.id}\n\n${lines}\n\nTotal: ${total}\n` +
		(lookupUrl ? `\nView your order: ${lookupUrl}\n` : "") +
		`\nKeep your order code (${order.id}) to look it up later.`;
	const rows = order.items
		.map(
			(i) =>
				`<tr><td style="padding:4px 0">${esc(i.title)} <span style="color:#6b6678">× ${i.quantity}</span></td><td style="padding:4px 0;text-align:right">${esc(formatMoney(i.lineTotal, order.currency))}</td></tr>`,
		)
		.join("");
	const html = layout("Thanks for your order!", `
<p style="margin:0 0 12px;color:#6b6678">Order <code style="font-family:ui-monospace,monospace">${esc(order.id)}</code></p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
<tr><td style="padding-top:12px;border-top:1px solid #e6e3da;font-weight:700">Total</td><td style="padding-top:12px;border-top:1px solid #e6e3da;text-align:right;font-weight:700">${esc(total)}</td></tr>
</table>
${lookupUrl ? `<p style="margin-top:20px"><a href="${esc(lookupUrl)}" style="background:#5b4bff;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;display:inline-block">View your order</a></p>` : ""}
<p style="margin-top:16px;color:#6b6678;font-size:13px">Keep your order code to look it up anytime.</p>`);
	return { to, subject: `Your ${STORE_NAME} order ${order.id}`, text, html };
}

export function orderFulfilledEmail(args: {
	to: string;
	order: OrderLike;
	lookupUrl?: string;
}): EmailMessage {
	const { to, order, lookupUrl } = args;
	const lines = order.items
		.map((i) => `  • ${i.title} × ${i.quantity}`)
		.join("\n");
	const text =
		`Good news — your order is on its way!\n\nOrder ${order.id}\n\n${lines}\n` +
		(lookupUrl ? `\nView your order: ${lookupUrl}\n` : "");
	const rows = order.items
		.map(
			(i) =>
				`<tr><td style="padding:4px 0">${esc(i.title)} <span style="color:#6b6678">× ${i.quantity}</span></td></tr>`,
		)
		.join("");
	const html = layout("Your order is on its way!", `
<p style="margin:0 0 12px;color:#6b6678">Order <code style="font-family:ui-monospace,monospace">${esc(order.id)}</code> has been fulfilled.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
${lookupUrl ? `<p style="margin-top:20px"><a href="${esc(lookupUrl)}" style="background:#5b4bff;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;display:inline-block">View your order</a></p>` : ""}`);
	return { to, subject: `Your ${STORE_NAME} order ${order.id} is on its way`, text, html };
}

export function refundRequestedEmail(args: {
	to: string;
	order: OrderLike;
	reason?: string;
}): EmailMessage {
	const { to, order, reason } = args;
	const total = formatMoney(order.total, order.currency);
	const text =
		`We've received your refund request for order ${order.id} (${total}).\n` +
		(reason ? `\nReason: ${reason}\n` : "") +
		`\nOur team will review it and email you once it's been processed.`;
	const html = layout("Refund request received", `
<p style="margin:0 0 12px">We've received your refund request for order <code style="font-family:ui-monospace,monospace">${esc(order.id)}</code> (${esc(total)}).</p>
${reason ? `<p style="margin:0 0 12px;color:#6b6678">Reason: ${esc(reason)}</p>` : ""}
<p style="color:#6b6678;font-size:13px">Our team will review it and email you once it's been processed.</p>`);
	return { to, subject: `We received your refund request for ${order.id}`, text, html };
}

export function newOrderAdminEmail(args: {
	to: string;
	order: OrderLike;
	customerEmail?: string;
	reviewUrl?: string;
}): EmailMessage {
	const { to, order, customerEmail, reviewUrl } = args;
	const total = formatMoney(order.total, order.currency);
	const lines = order.items
		.map((i) => `  • ${i.title} × ${i.quantity} — ${formatMoney(i.lineTotal, order.currency)}`)
		.join("\n");
	const text =
		`New order received.\n\nOrder: ${order.id}\n` +
		(customerEmail ? `Customer: ${customerEmail}\n` : "") +
		`\n${lines}\n\nTotal: ${total}\n` +
		(reviewUrl ? `\nReview it: ${reviewUrl}\n` : "");
	const rows = order.items
		.map(
			(i) =>
				`<tr><td style="padding:4px 0">${esc(i.title)} <span style="color:#6b6678">× ${i.quantity}</span></td><td style="padding:4px 0;text-align:right">${esc(formatMoney(i.lineTotal, order.currency))}</td></tr>`,
		)
		.join("");
	const html = layout("New order received", `
<p style="margin:0 0 12px;color:#6b6678">Order <code style="font-family:ui-monospace,monospace">${esc(order.id)}</code>${customerEmail ? ` — ${esc(customerEmail)}` : ""}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
<tr><td style="padding-top:12px;border-top:1px solid #e6e3da;font-weight:700">Total</td><td style="padding-top:12px;border-top:1px solid #e6e3da;text-align:right;font-weight:700">${esc(total)}</td></tr>
</table>
${reviewUrl ? `<p style="margin-top:20px"><a href="${esc(reviewUrl)}" style="background:#5b4bff;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;display:inline-block">Review in admin</a></p>` : ""}`);
	return { to, subject: `New order ${order.id} — ${total}`, text, html };
}

export function refundRequestAdminEmail(args: {
	to: string;
	order: OrderLike;
	customerEmail: string;
	reason?: string;
	reviewUrl?: string;
}): EmailMessage {
	const { to, order, customerEmail, reason, reviewUrl } = args;
	const total = formatMoney(order.total, order.currency);
	const text =
		`A refund has been requested.\n\nOrder: ${order.id}\nCustomer: ${customerEmail}\nAmount: ${total}\n` +
		(reason ? `Reason: ${reason}\n` : "") +
		(reviewUrl ? `\nReview it: ${reviewUrl}\n` : "");
	const html = layout("Refund requested", `
<p style="margin:0 0 12px">A customer has requested a refund.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
<tr><td style="padding:4px 0;color:#6b6678">Order</td><td style="padding:4px 0;text-align:right"><code style="font-family:ui-monospace,monospace">${esc(order.id)}</code></td></tr>
<tr><td style="padding:4px 0;color:#6b6678">Customer</td><td style="padding:4px 0;text-align:right">${esc(customerEmail)}</td></tr>
<tr><td style="padding:4px 0;color:#6b6678">Amount</td><td style="padding:4px 0;text-align:right;font-weight:700">${esc(total)}</td></tr>
</table>
${reason ? `<p style="margin:12px 0 0;color:#6b6678">Reason: ${esc(reason)}</p>` : ""}
${reviewUrl ? `<p style="margin-top:20px"><a href="${esc(reviewUrl)}" style="background:#5b4bff;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;display:inline-block">Review in admin</a></p>` : ""}`);
	return { to, subject: `Refund requested — order ${order.id}`, text, html };
}

export function refundApprovedEmail(args: {
	to: string;
	order: OrderLike;
}): EmailMessage {
	const { to, order } = args;
	const total = formatMoney(order.total, order.currency);
	const text =
		`Your refund for order ${order.id} has been approved.\n\n` +
		`${total} will be returned to your original payment method.`;
	const html = layout("Your refund has been approved", `
<p style="margin:0 0 12px">Your refund for order <code style="font-family:ui-monospace,monospace">${esc(order.id)}</code> has been approved.</p>
<p style="font-size:18px;font-weight:700;margin:0 0 12px">${esc(total)}</p>
<p style="color:#6b6678;font-size:13px">This will be returned to your original payment method.</p>`);
	return { to, subject: `Your ${STORE_NAME} refund for ${order.id} is approved`, text, html };
}

export function magicLinkEmail(args: { to: string; url: string }): EmailMessage {
	const { to, url } = args;
	return {
		to,
		subject: `Sign in to ${STORE_NAME}`,
		text: `Sign in to ${STORE_NAME} using this link (valid for 30 minutes):\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
		html: layout("Sign in", `
<p>Click below to sign in. This link is valid for 30 minutes.</p>
<p style="margin-top:16px"><a href="${esc(url)}" style="background:#5b4bff;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;display:inline-block">Sign in</a></p>
<p style="margin-top:16px;color:#6b6678;font-size:13px">If you didn't request this, ignore this email.</p>`),
	};
}

export function verifyEmail(args: { to: string; url: string }): EmailMessage {
	const { to, url } = args;
	return {
		to,
		subject: `Verify your email for ${STORE_NAME}`,
		text: `Confirm your email for ${STORE_NAME}:\n\n${url}`,
		html: layout("Verify your email", `
<p>Confirm your email to finish setting up your account.</p>
<p style="margin-top:16px"><a href="${esc(url)}" style="background:#5b4bff;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;display:inline-block">Verify email</a></p>`),
	};
}

export function passwordResetEmail(args: { to: string; url: string }): EmailMessage {
	const { to, url } = args;
	return {
		to,
		subject: `Reset your ${STORE_NAME} password`,
		text: `Reset your password (link valid for 30 minutes):\n\n${url}\n\nIf you didn't request this, ignore this email.`,
		html: layout("Reset your password", `
<p>Use the link below to set a new password. Valid for 30 minutes.</p>
<p style="margin-top:16px"><a href="${esc(url)}" style="background:#5b4bff;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;display:inline-block">Reset password</a></p>
<p style="margin-top:16px;color:#6b6678;font-size:13px">If you didn't request this, ignore this email.</p>`),
	};
}
