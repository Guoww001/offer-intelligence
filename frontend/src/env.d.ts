/// <reference types="vite/client" />

import type { Component } from "vue";
import type { LegacyBridgeApi, ModernAppApi } from "./legacy/contracts";

export interface CopilotKitRuntimeConfig {
  /** Server-issued production default; false selects the emergency legacy path. */
  readonly enabled?: boolean;
  /** Same-origin endpoint backed by the Python registry/proof adapter. */
  readonly endpoint?: string;
  /** Required capability marker for the safe opt-in path. */
  readonly authority?: "python-registry";
  readonly fallback?: "legacy";
}

declare global {
  interface Window {
    OI_LEGACY_BRIDGE?: LegacyBridgeApi;
    OI_COPILOTKIT_RUNTIME?: CopilotKitRuntimeConfig;
    OI_COPILOTKIT_AGENT_COMPONENT?: Component;
    OI_VUE_RUNTIME: typeof import("vue");
    OI_MODERN_APP: ModernAppApi;
  }
}

export {};
