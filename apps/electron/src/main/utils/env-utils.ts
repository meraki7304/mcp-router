import process from "node:process";
import execa from "execa";
import stripAnsi from "strip-ansi";
import { userInfo } from "node:os";
import { logInfo } from "@/main/utils/logger";

const DELIMITER = "_ENV_DELIMITER_";

/**
 * Check if a command exists in the system's PATH
 * @param cmd Command to check
 * @returns boolean indicating whether the command exists
 */
export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const shellEnv = await getUserShellEnv();
    // Get PATH from shell environment
    const PATH = shellEnv.PATH || shellEnv.Path || process.env.PATH;
    if (!PATH) return false;

    // Check if the command exists using 'which' on Unix or 'where' on Windows
    const checkCommand = process.platform === "win32" ? "where" : "which";
    await execa(checkCommand, [cmd], {
      env: shellEnv,
      stdio: "ignore",
      reject: true,
    });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Run a command with proper logging
 * @param cmd Command to run or executable path
 * @param args Array of arguments to pass to the command
 * @param useShell Whether to use shell for command execution (default: false)
 * @param useShellEnv Whether to use the user's shell environment (default: true)
 * @returns Command output as string
 */
export async function run(cmd: string, args: string[] = [], useShell = false) {
  const cmdDisplay = useShell ? cmd : `${cmd} ${args.join(" ")}`;
  logInfo(`\n> ${cmdDisplay}, useShell: ${useShell}\n`);

  try {
    // If useShellEnv is true, get and merge user's shell environment
    const shellEnv = await getUserShellEnv();

    // Change stdio to pipe both stdout and stderr
    const { stdout, stderr } = await execa(cmd, args, {
      shell: useShell,
      stdio: ["inherit", "pipe", "pipe"], // Changed to pipe stderr as well
      env: shellEnv,
    });

    // Return the combined output if stdout is empty but stderr has content
    // This handles commands that output to stderr instead of stdout
    return stdout || stderr;
  } catch (err) {
    // For errors, try to extract any useful output from stderr/stdout
    if (
      err &&
      typeof err === "object" &&
      ("stderr" in err || "stdout" in err)
    ) {
      const errorOutput = (err as any).stdout || (err as any).stderr;
      return errorOutput; // Return any output even on error
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
    // 以登录（-l）+ 交互（-i）模式执行 shell 并获取 env；
    // DISABLE_AUTO_UPDATE 用于抑制 oh-my-zsh 自动更新
    const shell = detectDefaultShell();
    const { stdout } = await execa(
      shell,
      ["-ilc", `echo -n "${DELIMITER}"; env; echo -n "${DELIMITER}"`],
      {
        env: {
          DISABLE_AUTO_UPDATE: "true",
        },
      },
    );

    // 输出格式为 '_ENV_DELIMITER_env_vars_ENV_DELIMITER_'，按分隔符截取后解析
    const parts = stdout.split(DELIMITER);
    const rawEnv = parts[1] || "";

    const shellEnv: { [key: string]: string } = {};
    for (const line of stripAnsi(rawEnv).split("\n")) {
      if (!line) continue;
      const [key, ...values] = line.split("=");
      shellEnv[key] = values.join("=");
    }

    return shellEnv;
  } catch (error) {
    // shell 启动失败时，回退到 Electron / Node.js 的当前环境变量
    return { ...process.env };
  }
}

/**
 * Detect the default shell for the current platform
 * @returns The path to the default shell
 */
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
