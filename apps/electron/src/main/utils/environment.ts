import { app } from "electron";

type EnvironmentType = "development" | "production";

let currentEnvironment: EnvironmentType = app.isPackaged
  ? "production"
  : "development";

/**
 * 从启动参数初始化环境设置。
 * 可通过 --env=production 或 --env=development 指定，也可通过 ELECTRON_ENV 环境变量覆盖。
 */
export function initializeEnvironment(): void {
  const args = process.argv;
  const envArgIndex = args.findIndex((arg) => arg.startsWith("--env="));

  if (envArgIndex !== -1) {
    const envValue = args[envArgIndex].split("=")[1];
    if (envValue === "production" || envValue === "development") {
      currentEnvironment = envValue;
    }
  }

  if (process.env.ELECTRON_ENV === "production") {
    currentEnvironment = "production";
  } else if (process.env.ELECTRON_ENV === "development") {
    currentEnvironment = "development";
  }
}

export function isProduction(): boolean {
  return currentEnvironment === "production";
}

export function isDevelopment(): boolean {
  return currentEnvironment === "development";
}
