/**
 * Admin UI exports (React) — loaded into the EmDash admin browser bundle via the
 * descriptor's `adminEntry`. EmDash imports this as a namespace and reads the
 * `pages`, `widgets` and `fields` maps. Pages/widgets are component *types*
 * (functions), keyed to match the paths/ids declared in the plugin descriptor.
 */
import type { ComponentType } from "react";
import { DashboardWidget } from "./admin/DashboardWidget";
import { InventoryPage } from "./admin/InventoryPage";
import { OrdersPage } from "./admin/OrdersPage";
import { SetupPage } from "./admin/SetupPage";

export const pages: Record<string, ComponentType> = {
	"/setup": SetupPage,
	"/orders": OrdersPage,
	"/inventory": InventoryPage,
};

export const widgets: Record<string, ComponentType> = {
	dashboard: DashboardWidget,
};

export const fields: Record<string, ComponentType> = {};
