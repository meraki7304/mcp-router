import { app, BrowserWindow, session, shell, nativeTheme } from "electron";
import path from "node:path";
import { MCPServerManager } from "@/main/modules/mcp-server-manager/mcp-server-manager";
import { AggregatorServer } from "@/main/modules/mcp-server-runtime/aggregator-server";
import { MCPHttpServer } from "@/main/modules/mcp-server-runtime/http/mcp-http-server";
import { ToolCatalogService } from "@/main/modules/tool-catalog/tool-catalog.service";
import { setApplicationMenu } from "@/main/ui/menu";
import { createTray, updateTrayContextMenu } from "@/main/ui/tray";
import { getPlatformAPIManager } from "@/main/modules/workspace/platform-api-manager";
import { getWorkspaceService } from "@/main/modules/workspace/workspace.service";
import { getSharedConfigManager } from "@/main/infrastructure/shared-config-manager";
import { setupIpcHandlers } from "./main/infrastructure/ipc";
import { setupAutoUpdate } from "./main/modules/system/app-updator";
import { getIsAutoUpdateInProgress } from "./main/modules/system/system-handler";
import { initializeEnvironment, isDevelopment } from "@/main/utils/environment";
import {
  applyLoginItemSettings,
  applyThemeSettings,
  getSettingsService,
} from "@/main/modules/settings/settings.service";

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // If we can't get the lock, it means another instance is running
  // Exit this instance, but the first instance will be notified via second-instance event
  app.exit();
}

// Listen for second instance launches and focus the existing window
app.on("second-instance", (_event, commandLine) => {
  // Show the app in the Dock on macOS
  if (process.platform === "darwin" && app.dock) {
    app.dock.show();
  }

  // Focus the existing window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }

  // Check for protocol URLs in the command line arguments
  // Protocol URLs would be the last argument in the command line
  const url = commandLine.find((arg) => arg.startsWith("mcpr://"));
  if (url) {
    handleProtocolUrl(url);
  }
});

// Global references
export let mainWindow: BrowserWindow | null = null;
// Flag to track if app.quit() was explicitly called
let isQuitting = false;
// Timer for updating tray context menu
let trayUpdateTimer: NodeJS.Timeout | null = null;

let serverManager: MCPServerManager;
let aggregatorServer: AggregatorServer;
let mcpHttpServer: MCPHttpServer;
let toolCatalogService: ToolCatalogService;

type CreateWindowOptions = {
  showOnCreate?: boolean;
};

const createWindow = ({ showOnCreate = true }: CreateWindowOptions = {}) => {
  // Platform-specific window options
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "MCP Router",
    icon: path.join(__dirname, "assets/icon.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDevelopment(),
    },
  };

  // Platform-specific title bar configuration
  if (process.platform === "darwin") {
    // macOS: hidden title bar with traffic light buttons
    windowOptions.titleBarStyle = "hidden";
    windowOptions.trafficLightPosition = { x: 20, y: 19 }; // y = (50-12)/2 ≈ 19 for vertical center
  } else if (process.platform === "win32") {
    // Windows: use titleBarOverlay for custom title bar
    windowOptions.titleBarStyle = "hidden";
    windowOptions.titleBarOverlay = {
      height: 50,
    };
  } else {
    // Linux: use default title bar
    windowOptions.frame = true;
  }

  // Create the browser window.
  mainWindow = new BrowserWindow(windowOptions);

  // Apply Windows title bar overlay colors based on system theme
  if (process.platform === "win32") {
    const applyTitleBarColors = () => {
      if (!mainWindow) return;
      const isDark = nativeTheme.shouldUseDarkColors;
      const isHighContrast = nativeTheme.shouldUseHighContrastColors;
      const overlayColor = isHighContrast
        ? "#00000000" // transparent in high contrast, let OS handle
        : isDark
          ? "#0a0a0a"
          : "#ffffff";
      const symbolColor = isHighContrast
        ? undefined
        : isDark
          ? "#ffffff"
          : "#000000";
      mainWindow.setTitleBarOverlay({
        color: overlayColor,
        symbolColor,
        height: 50,
      });
    };

    applyTitleBarColors();
    nativeTheme.on("updated", applyTitleBarColors);
    mainWindow.on("closed", () => {
      nativeTheme.removeListener("updated", applyTitleBarColors);
    });
  }

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) {
      return;
    }

    if (showOnCreate) {
      mainWindow.show();
    } else {
      mainWindow.hide();
    }
  });

  // electron-vite 在 dev 模式下注入 ELECTRON_RENDERER_URL（指向 vite dev server），
  // 生产构建后从 out/renderer 读取打包好的 index.html
  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Handle window close event - hide instead of closing completely
  mainWindow.on("close", (event) => {
    // If app.quit() was called explicitly (from tray menu) or auto-update is in progress, don't prevent the window from closing
    if (isQuitting || getIsAutoUpdateInProgress()) return;

    // Otherwise prevent the window from closing by default
    event.preventDefault();

    if (mainWindow) {
      // Just hide the window instead of closing it
      mainWindow.hide();

      // Hide the app from the Dock on macOS when window is closed
      if (process.platform === "darwin" && app.dock) {
        app.dock.hide();
      }
    }
  });

  // Handle actual window closed event if it occurs
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDevelopment()) {
    mainWindow.webContents.openDevTools();
  }
};

/**
 * Sets up a timer to periodically update the tray context menu
 * @param serverManager The MCPServerManager instance
 * @param intervalMs Time between updates in milliseconds
 */
function setupTrayUpdateTimer(
  serverManager: MCPServerManager,
  intervalMs = 5000,
) {
  if (trayUpdateTimer) {
    clearInterval(trayUpdateTimer);
  }

  trayUpdateTimer = setInterval(() => {
    updateTrayContextMenu(serverManager);
  }, intervalMs);
}

async function initDatabase(): Promise<void> {
  try {
    // 初始化共享配置管理器（含从现有数据迁移）
    await getSharedConfigManager().initialize();

    const workspaceService = getWorkspaceService();

    const activeWorkspace = await workspaceService.getActiveWorkspace();
    if (!activeWorkspace) {
      await workspaceService.switchWorkspace("local-default");
    }

    // 工作区专用数据库的迁移由 PlatformAPIManager 在初始化时执行
  } catch (error) {
    console.error(
      "数据库迁移过程中发生错误:",
      error,
    );
  }
}

async function initMCPServices(): Promise<void> {
  // 初始化 Platform API Manager（配置工作区 DB）；先设置 serverManager 提供者（serverManager 稍后赋值）
  getPlatformAPIManager().setServerManagerProvider(() => serverManager);
  await getPlatformAPIManager().initialize();

  serverManager = new MCPServerManager();

  // 从数据库加载服务器列表
  await serverManager.initializeAsync();

  // Tool catalog service
  toolCatalogService = new ToolCatalogService(serverManager);

  aggregatorServer = new AggregatorServer(serverManager, toolCatalogService);

  mcpHttpServer = new MCPHttpServer(serverManager, 3282, aggregatorServer);
  try {
    await mcpHttpServer.start();
  } catch (error) {
    console.error("Failed to start MCP HTTP Server:", error);
  }
}

function initUI({
  showMainWindow = true,
}: { showMainWindow?: boolean } = {}): void {
  createWindow({ showOnCreate: showMainWindow });

  if (!showMainWindow && process.platform === "darwin" && app.dock) {
    app.dock.hide();
  }

  if (mainWindow) {
    getPlatformAPIManager().setMainWindow(mainWindow);
  }

  createTray(serverManager);

  setupTrayUpdateTimer(serverManager);
}

async function initApplication(): Promise<void> {
  initializeEnvironment();
  const DEV_CSP = `
    default-src 'self' 'unsafe-inline' http://localhost:* ws://localhost:*;
    script-src 'self' 'unsafe-eval' 'unsafe-inline';
    connect-src 'self' http://localhost:* ws://localhost:* https://github.com https://api.github.com https://objects.githubusercontent.com;
    img-src 'self' data:;
  `
    .replace(/\s+/g, " ")
    .trim();

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [DEV_CSP],
      },
    });
  });

  app.setName("MCP Router");

  setApplicationMenu();

  const settingsService = getSettingsService();
  let showWindowOnStartup = true;
  try {
    const currentSettings = settingsService.getSettings();
    showWindowOnStartup = currentSettings.showWindowOnStartup ?? true;
    applyThemeSettings(currentSettings.theme);
  } catch (error) {
    console.error(
      "Failed to load startup visibility preference, defaulting to true:",
      error,
    );
  }

  const loginItemState = app.getLoginItemSettings();
  const launchedAtLogin = loginItemState.wasOpenedAtLogin ?? false;
  const launchedWithHiddenFlag = process.argv.some((arg) =>
    ["--hidden", "--minimized"].includes(arg),
  );

  applyLoginItemSettings(showWindowOnStartup);

  await initDatabase();

  await initMCPServices();

  setupIpcHandlers({
    getServerManager: () => serverManager,
  });

  const shouldShowMainWindow =
    (!launchedAtLogin || showWindowOnStartup) && !launchedWithHiddenFlag;

  initUI({ showMainWindow: shouldShowMainWindow });

  // 启动后非阻塞地拉起自动更新检查，未签名 / 无网络 / dev 模式都会被静默跳过
  setupAutoUpdate();
}

app.on("ready", initApplication);

// Keep the app running when all windows are closed
// The app will continue to run in the background with only the tray icon visible
app.on("window-all-closed", () => {
  // Don't quit the app regardless of platform
  // The app will remain active with the tray icon
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide(); // Hide from dock when all windows are closed
  }
  // console.log('All windows closed, app continues running in the background');
});

app.on("activate", () => {
  // Show the app in the Dock on macOS when activated
  if (process.platform === "darwin" && app.dock) {
    app.dock.show();
  }

  // Re-create a window if there are no windows open
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    if (mainWindow && mainWindow.isMinimized()) mainWindow.restore();
    if (mainWindow) mainWindow.show();
    if (mainWindow) mainWindow.focus();
  }
});

// Register the app as default handler for mcpr:// protocol
app.whenReady().then(() => {
  app.setAsDefaultProtocolClient("mcpr");
});

// Handle the mcpr:// protocol on macOS
app.on("open-url", (event, url) => {
  event.preventDefault();

  // Store the URL to be processed after app is ready if needed
  const processUrl = () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else if (app.isReady()) {
      createWindow();
    } else {
      // If app is not ready yet, wait until it is before creating the window
      app.whenReady().then(() => {
        createWindow();
        // Process the URL after the window is created
        handleProtocolUrl(url);
      });
      return; // Return early to avoid processing URL twice
    }
    handleProtocolUrl(url);
  };

  processUrl();
});

// Clean up when quitting
app.on("will-quit", async () => {
  // Clear the tray update timer
  if (trayUpdateTimer) {
    clearInterval(trayUpdateTimer);
    trayUpdateTimer = null;
  }
  // Stop the HTTP server
  try {
    await mcpHttpServer.stop();
  } catch (error) {
    console.error("Failed to stop MCP HTTP Server:", error);
  }

  serverManager.shutdown();
  aggregatorServer.shutdown();
});

// Override the default app.quit to set our isQuitting flag first
const originalQuit = app.quit;
app.quit = function (...args) {
  // Set the flag to allow the window to close
  isQuitting = true;
  // Call the original quit method
  return originalQuit.apply(this, args);
};

// Process protocol URLs (mcpr://) - replaces the old protocol.registerHttpProtocol handler
export async function handleProtocolUrl(urlString: string) {
  try {
    if (mainWindow) {
      mainWindow.webContents.send("protocol:url", urlString);
    }
  } catch (error) {
    console.error("Failed to process protocol URL:", error);
  }
}
