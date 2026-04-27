import process from "node:process";
import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { logInfo } from "@/main/utils/logger";

const DELIMITER = "_ENV_DELIMITER_";

interface SpawnPromiseOptions {
  env?: NodeJS.ProcessEnv;
  shell?: boolean | string;
  cwd?: string;
  stdio?: "ignore" | ("ignore" | "inherit" | "pipe")[];
}

interface SpawnPromiseResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * 用 node 内置 child_process.spawn 包出一个最小 promise 接口，
 * 替代 execa——避免 monorepo + electron-builder 下 execa 间接依赖
 * 走 .pnpm 虚拟目录而漏进 asar 的 hoist 噩梦。
 */
function spawnPromise(
  cmd: string,
  args: string[] = [],
  options: SpawnPromiseOptions = {},
): Promise<SpawnPromiseResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: options.env,
      shell: options.shell ?? false,
      cwd: options.cwd,
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * 去掉 ANSI 控制序列（CSI 与 OSC）。
 * 替代 strip-ansi 包；规则参考其源码的两个 regex。
 */
function stripAnsi(input: string): string {
  return input.replace(
    /[][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );
}

/**
 * Check if a command exists in the system's PATH
 */
export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const shellEnv = await getUserShellEnv();
    const PATH = shellEnv.PATH || shellEnv.Path || process.env.PATH;
    if (!PATH) return false;

    const checkCommand = process.platform === "win32" ? "where" : "which";
    const { exitCode } = await spawnPromise(checkCommand, [cmd], {
      env: shellEnv,
      stdio: "ignore",
    });
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Run a command with proper logging
 */
export async function run(cmd: string, args: string[] = [], useShell = false) {
  const cmdDisplay = useShell ? cmd : `${cmd} ${args.join(" ")}`;
  logInfo(`\n> ${cmdDisplay}, useShell: ${useShell}\n`);

  try {
    const shellEnv = await getUserShellEnv();
    const { stdout, stderr } = await spawnPromise(cmd, args, {
      shell: useShell,
      env: shellEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    return stdout || stderr;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      ("stderr" in err || "stdout" in err)
    ) {
      const errorOutput = (err as any).stdout || (err as any).stderr;
      return errorOutput;
    }
    throw err;
  }
}

// 获取用户 shell 加载的环境变量
export async function getUserShellEnv() {
  // Windows 不存在 shell 初始化文件问题，直接返回当前环境变量
  if (process.platform === "win32") {
    return { ...process.env };
  }

  try {
    const shell = detectDefaultShell();
    const { stdout } = await spawnPromise(
      shell,
      ["-ilc", `echo -n "${DELIMITER}"; env; echo -n "${DELIMITER}"`],
      {
        env: { DISABLE_AUTO_UPDATE: "true" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // 输出格式 '_ENV_DELIMITER_env_vars_ENV_DELIMITER_'，按分隔符截取后解析
    const parts = stdout.split(DELIMITER);
    const rawEnv = parts[1] || "";

    const shellEnv: { [key: string]: string } = {};
    for (const line of stripAnsi(rawEnv).split("\n")) {
      if (!line) continue;
      const [key, ...values] = line.split("=");
      shellEnv[key] = values.join("=");
    }

    return shellEnv;
  } catch {
    return { ...process.env };
  }
}

const detectDefaultShell = () => {
  const { env } = process;

  if (process.platform === "win32") {
    return env.COMSPEC || "cmd.exe";
  }

  const { shell } = userInfo();
  if (shell) {
    return shell;
  }

  if (process.platform === "darwin") {
    return env.SHELL || "/bin/zsh";
  }

  return env.SHELL || "/bin/sh";
};
