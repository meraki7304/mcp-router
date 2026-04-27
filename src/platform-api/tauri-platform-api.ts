import { invoke } from "@tauri-apps/api/core";

export async function ping(name: string): Promise<string> {
  return invoke<string>("ping", { name });
}
