// Platform-independent stores (no PlatformAPI dependency)
export * from "./ui-store";
export * from "./server-editing-store";
export * from "./view-preferences-store";

// Platform-dependent store factories
export * from "./server-store";
export * from "./project-store";
export * from "./theme-store";

// Import store factories
import { createServerStore } from "./server-store";
import { createThemeStore, initializeThemeStore } from "./theme-store";
import { electronPlatformAPI } from "../platform-api/electron-platform-api";

function getPlatformAPI() {
  return electronPlatformAPI;
}

export const useServerStore = createServerStore(getPlatformAPI);
export const useThemeStore = createThemeStore(getPlatformAPI);

export const initializeStores = async () => {
  try {
    await initializeThemeStore(useThemeStore, getPlatformAPI);
  } catch (error) {
    console.error("Failed to initialize theme from settings:", error);
  }

  try {
    await useServerStore.getState().refreshServers();
  } catch (error) {
    console.error("Failed to load initial servers:", error);
  }
};
