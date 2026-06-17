/**
 * Admin UI exports (React) — loaded in the EmDash admin browser bundle via the
 * descriptor's `adminEntry`. Imported as a namespace, so EmDash reads the
 * `pages`, `widgets` and `fields` maps from here.
 *
 * Populated in later milestones (Setup/Config panel, Orders, Inventory,
 * dashboard widget). Kept as empty registries for now so the entry resolves.
 */
import type { JSX } from "react";

export const pages: Record<string, JSX.Element> = {};
export const widgets: Record<string, JSX.Element> = {};
export const fields: Record<string, JSX.Element> = {};
