import { logError } from "@/main/utils/logger";

/**
 * 单例服务基类
 *
 * 提供以下功能：
 * 1. 单例模式实现
 * 2. 切换工作区时重置实例
 * 3. 动态获取 Repository（支持工作区切换）
 * 4. 通用错误处理
 *
 * @template T - 服务处理的实体类型
 * @template K - 实体 ID 类型（默认 string）
 * @template S - 服务类自身的类型
 */
export abstract class SingletonService<T, K = string, S = any> {
  // key: 服务类构造函数，value: 服务实例
  private static instances: Map<Function, any> = new Map();

  public constructor() {}

  protected abstract getEntityName(): string;

  protected handleError(
    operation: string,
    error: unknown,
    defaultValue?: any,
  ): any {
    const entityName = this.getEntityName();
    const message = `${entityName} 执行 ${operation} 时发生错误`;
    logError(message, error);

    if (arguments.length > 2) {
      return defaultValue;
    }

    throw error;
  }

  protected static getInstanceBase<T extends SingletonService<any, any, any>>(
    this: new () => T,
  ): T {
    if (!SingletonService.instances.has(this)) {
      SingletonService.instances.set(this, new this());
    }
    return SingletonService.instances.get(this) as T;
  }

  protected static resetInstanceBase<T extends Function>(
    ServiceClass: T,
  ): void {
    SingletonService.instances.delete(ServiceClass);
  }

  public static resetAllInstances(): void {
    SingletonService.instances.clear();
  }
}
