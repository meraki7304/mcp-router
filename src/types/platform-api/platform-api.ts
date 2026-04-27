/**
 * Platform API interface with consolidated domain structure
 */

import { ServerAPI } from "./domains/server-api";
import { AppAPI } from "./domains/app-api";
import { PackageAPI } from "./domains/package-api";
import { SettingsAPI } from "./domains/settings-api";
import { LogAPI } from "./domains/log-api";
import { WorkflowAPI } from "./domains/workflow-api";
import { ProjectsAPI } from "./domains/projects-api";

/**
 * Main Platform API interface with domain-driven structure
 * Consolidates related functionality into logical domains
 */
export interface PlatformAPI {
  // Server management domain
  servers: ServerAPI;

  // Application management domain (includes token management)
  apps: AppAPI;

  // Package management domain (includes system utilities)
  packages: PackageAPI;

  // Settings management domain
  settings: SettingsAPI;

  // Log management domain
  logs: LogAPI;

  // Workflow and Hook Module management domain
  workflows: WorkflowAPI;

  // Projects management domain
  projects: ProjectsAPI;
}
