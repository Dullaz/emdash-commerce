/**
 * Provider registry + selection. The active provider is chosen by the
 * `provider` plugin setting (defaults to "mock").
 */
import { getPluginSetting } from "emdash";
import { PLUGIN_ID } from "../constants";
import { mockProvider } from "./mock";
import { rootlineProvider } from "./rootline";
import type { PaymentProvider } from "./provider";

export const PROVIDERS: PaymentProvider[] = [mockProvider, rootlineProvider];
export const DEFAULT_PROVIDER_ID = "mock";

/** Resolve a provider by id, falling back to the mock provider. */
export function getProvider(id: string | undefined | null): PaymentProvider {
	return PROVIDERS.find((p) => p.id === id) ?? mockProvider;
}

/** The configured provider id (from plugin settings), default "mock". */
export async function loadProviderId(): Promise<string> {
	return (
		(await getPluginSetting<string>(PLUGIN_ID, "provider")) ?? DEFAULT_PROVIDER_ID
	);
}

export async function getActiveProvider(): Promise<PaymentProvider> {
	return getProvider(await loadProviderId());
}

export * from "./provider";
