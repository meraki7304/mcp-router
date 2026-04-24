import { HookModule } from "@mcp_router/shared";
import { getHookRepository, HookRepository } from "./hook.repository";
import vm from "vm";

/**
 * Hook Module 领域服务
 * 提供 Hook Module 的业务逻辑与后端服务
 */
export class HookService {
  private static instance: HookService | null = null;
  private repository: HookRepository;

  private constructor() {
    this.repository = getHookRepository();
  }

  public static getInstance(): HookService {
    if (!HookService.instance) {
      HookService.instance = new HookService();
    }
    return HookService.instance;
  }

  public static resetInstance(): void {
    HookService.instance = null;
  }

  public async getAllHookModules(): Promise<HookModule[]> {
    return this.repository.getAllHookModules();
  }

  public async getHookModuleById(id: string): Promise<HookModule | null> {
    return this.repository.getHookModuleById(id);
  }

  public async getHookModuleByName(name: string): Promise<HookModule | null> {
    return this.repository.getHookModuleByName(name);
  }

  public async createHookModule(
    module: Omit<HookModule, "id">,
  ): Promise<HookModule> {
    this.validateHookModule(module);

    const validation = await this.validateHookScript(module.script);
    if (!validation.valid) {
      throw new Error(`Invalid hook script: ${validation.error}`);
    }

    return this.repository.createHookModule(module);
  }

  public async updateHookModule(
    id: string,
    updates: Partial<Omit<HookModule, "id">>,
  ): Promise<HookModule | null> {
    if (updates.script) {
      const validation = await this.validateHookScript(updates.script);
      if (!validation.valid) {
        throw new Error(`Invalid hook script: ${validation.error}`);
      }
    }

    if (updates.name) {
      const existing = await this.getHookModuleByName(updates.name);
      if (existing && existing.id !== id) {
        throw new Error(
          `Hook module with name "${updates.name}" already exists`,
        );
      }
    }

    return this.repository.updateHookModule(id, updates);
  }

  public async deleteHookModule(id: string): Promise<boolean> {
    const { WorkflowService } = await import("./workflow.service");
    const workflowService = WorkflowService.getInstance();
    const workflows = await workflowService.getAllWorkflows();

    const usingWorkflows: string[] = [];
    for (const workflow of workflows) {
      for (const node of workflow.nodes) {
        if (node.type === "hook") {
          const hook = node.data?.hook as any;
          if (hook?.hookModuleId === id) {
            usingWorkflows.push(workflow.name);
          }
        }
      }
    }

    if (usingWorkflows.length > 0) {
      throw new Error(
        `Cannot delete hook module. It is used by workflow(s): ${usingWorkflows.join(", ")}`,
      );
    }

    return this.repository.deleteHookModule(id);
  }

  public async importHookModule(
    module: Omit<HookModule, "id">,
  ): Promise<HookModule> {
    this.validateHookModule(module);

    const validation = await this.validateHookScript(module.script);
    if (!validation.valid) {
      throw new Error(`Invalid hook script: ${validation.error}`);
    }

    return this.repository.importHookModule(module);
  }

  public async executeHookModule(id: string, context: any): Promise<any> {
    const module = await this.getHookModuleById(id);
    if (!module) {
      throw new Error(`Hook module not found: ${id}`);
    }

    return this.executeHookScript(module.script, context);
  }

  public async executeHookScript(script: string, context: any): Promise<any> {
    try {
      const sandbox = {
        context,
        console: {
          log: (...args: any[]) => console.log(`[Hook]`, ...args),
          error: (...args: any[]) => console.error(`[Hook]`, ...args),
          warn: (...args: any[]) => console.warn(`[Hook]`, ...args),
        },
        JSON,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Date,
        Math,
        Promise,
      };

      const wrappedScript = `
        (async function() {
          ${script}
        })()
      `;

      const vmScript = new vm.Script(wrappedScript);
      const vmContext = vm.createContext(sandbox);

      // 超时限制 5 秒
      const result = await vmScript.runInContext(vmContext, {
        timeout: 5000,
        displayErrors: true,
      });

      return result;
    } catch (error: any) {
      console.error("Hook execution error:", error);
      throw new Error(`Hook execution failed: ${error.message}`);
    }
  }

  public async validateHookScript(
    script: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      // 仅做语法检查，不实际执行
      new vm.Script(script);
      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || "Invalid JavaScript syntax",
      };
    }
  }

  private validateHookModule(module: any): void {
    if (!module.name || module.name.trim().length === 0) {
      throw new Error("Hook module name is required");
    }

    if (!module.script || module.script.trim().length === 0) {
      throw new Error("Hook module script is required");
    }

    if (module.name.length > 100) {
      throw new Error("Hook module name is too long (max 100 characters)");
    }

    if (module.script.length > 1024 * 1024) {
      throw new Error("Hook module script is too large (max 1MB)");
    }
  }
}

export function getHookService(): HookService {
  return HookService.getInstance();
}
