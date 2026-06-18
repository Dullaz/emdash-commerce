# @buysomepixels/commerce

Ecommerce for EmDash: products, inventory, orders, checkout, and a pluggable
payment-provider abstraction. Native-format plugin (runs in-process; ships a
React admin UI).

## What it does

- **Products** are a normal EmDash **content collection** (so you get the full
  CMS editor, images, drafts, SEO, search). The plugin is *configured* to point
  at a collection — it does not own product schema.
- **Orders, inventory, carts, payments** live in the plugin's own storage.
- **Payments** go through a `PaymentProvider` interface. A working **mock**
  provider ships for development; **rootline** (staging) is scaffolded behind the
  same interface.

EmDash plugins cannot create or alter content-collection schema from their
runtime context (no `schema:write` capability). The setup panel works around
this by calling the official admin schema API **as the logged-in admin**.

## Install

```js
// astro.config.mjs
import { commercePlugin } from "@buysomepixels/commerce";

export default defineConfig({
  integrations: [
    emdash({
      database: d1({ binding: "DB" }),
      storage: r2({ binding: "MEDIA" }),
      plugins: [commercePlugin({ defaultCurrency: "USD" })],
    }),
  ],
});
```

## Store setup (admin)

Open **Store setup** in the admin (`/_emdash/admin/plugins/buysomepixels-commerce/setup`):

- **Create a new collection** — provisions a `products` collection with all
  required fields, or
- **Use an existing collection** — pick one, validate the required fields, and
  one-click **add any missing fields**.

The chosen collection slug + field mapping are saved to plugin KV. If nothing is
configured, the store falls back to a collection named `products`.

### Required product fields

| Role          | Default slug  | Type           | Notes                                   |
| ------------- | ------------- | -------------- | --------------------------------------- |
| title         | `title`       | string         | required                                |
| price         | `price`       | integer        | required — **minor units** (2500 = $25) |
| currency      | `currency`    | string         | ISO-4217; falls back to store default   |
| sku           | `sku`         | string         |                                         |
| image         | `image`       | image          |                                         |
| description   | `description` | portableText   |                                         |
| active        | `active`      | boolean        | `false` hides from the store            |

## Payments

Set the provider under the plugin's **settings** (auto-generated form):

- `provider` — `mock` (default) or `rootline`
- `rootlineBaseUrl`, `rootlineApiKey`, `rootlineWebhookSecret` — rootline staging
  credentials (stored encrypted)

### Adding a provider

Implement `PaymentProvider` (`src/payments/provider.ts`) and register it in
`src/payments/index.ts`:

```ts
export interface PaymentProvider {
  id: string;
  label: string;
  createCheckout(args): Promise<{ checkoutId: string; redirectUrl: string }>;
  handleWebhook(args): Promise<{ orderId: string; outcome: "paid" | "failed" | "cancelled"; providerPaymentId?: string }>;
  refund(args): Promise<{ refunded: boolean; providerRefundId?: string }>;
}
```

`createCheckout` returns where to send the buyer; `handleWebhook` maps the
provider's callback to an order outcome (the order id travels as the provider
`reference`); `refund` reverses a captured payment. Read credentials from plugin
settings via `getPluginSetting()` — never hardcode secrets.

> **rootline** endpoints/auth/webhook signature are provisional (see
> `src/payments/rootline.ts` TODOs) and finalised once staging details land.
> Until configured, rootline fails fast with a clear "not configured" error.

## Email (Cloudflare)

The plugin registers the EmDash `email:deliver` transport and sends transactional
email (order confirmations, and — see accounts — magic links / verification /
reset) via **Cloudflare Email Sending's REST API** (plugin context can't reach
the `send_email` Worker binding). Configure in plugin **settings**:

- `cfAccountId` — Cloudflare account ID
- `cfApiToken` — API token with Email Sending permission (secret)
- `fromEmail` — a from address on a domain onboarded to Email Sending
- `fromName` — display name

Prerequisites: `bunx wrangler email sending enable <domain>` (or the dashboard),
then mint the token. In **dev**, EmDash's built-in console transport captures
email instead (look for `📧 [dev-email]` in the dev log), so you can exercise the
flows without real sends. In **production**, the Cloudflare transport delivers.
If unconfigured in production, delivery throws a clear error and best-effort
sends (e.g. order confirmation) are swallowed so checkout never breaks.

## Order lifecycle

```
pending → awaiting_payment → paid → fulfilled
                 │             └→ refunded
                 ├→ cancelled
                 └→ expired
```

Stock is **reserved** at checkout, **committed** (decremented) on payment, and
**released** on cancel/expiry. Untracked products sell without limit; enable
tracking per product on the **Inventory** admin page.

## API routes

Mounted at `/_emdash/api/plugins/buysomepixels-commerce/<route>`.

| Route            | Method | Auth   | Purpose                          |
| ---------------- | ------ | ------ | -------------------------------- |
| `availability`   | GET    | public | Live stock for product ids       |
| `cart`           | GET    | public | Read cart by `?token=`           |
| `cart/add`       | POST   | public | Add a product                    |
| `cart/set`       | POST   | public | Set/remove a line quantity       |
| `cart/clear`     | POST   | public | Empty the cart                   |
| `checkout`       | POST   | public | Reserve + start provider checkout |
| `webhook`        | POST   | public | Provider callback → order outcome |
| `order`          | GET    | public | Sanitised order (success page)   |
| `config`         | GET    | admin  | Effective store config           |
| `config/save`    | POST   | admin  | Save collection + field map      |
| `orders`         | GET    | admin  | List orders                      |
| `orders/refund`  | POST   | admin  | Refund + restock                 |
| `orders/fulfill` | POST   | admin  | Mark fulfilled                   |
| `inventory`      | GET    | admin  | Products joined with stock       |
| `inventory/set`  | POST   | admin  | Set tracking + on-hand           |
| `stats`          | GET    | admin  | Dashboard metrics                |

## Development

```bash
bun test packages/commerce          # domain + provider unit tests
bunx tsc -p packages/commerce/tsconfig.json --noEmit
```

Money is always integer minor units. Domain logic (`src/domain.ts`) is pure and
unit-tested; storage binding is in `src/store.ts`.
