/// <reference types="vite/client" />

import type { LegacyBridgeApi, ModernAppApi } from "./legacy/contracts";

declare global {
  interface Window {
    OI_LEGACY_BRIDGE?: LegacyBridgeApi;
    OI_MODERN_APP: ModernAppApi;
  }
}

export {};
