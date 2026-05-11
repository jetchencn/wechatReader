/**
 * 统一的 invoke 抽象层 — 自动适配 Tauri 桌面端 / 网页端 / Mock 数据。
 *
 * 调用链优先级：
 *   1. Tauri invoke（桌面端原生）
 *   2. CLI API（网页端，通过 Vite 中间件调用 wechat-reader CLI）
 *   3. Mock handlers（纯前端模拟数据，用于开发/演示）
 */

import { tryCliApi } from './cli-api';
import { mockHandlers } from './mock-handlers';

// ---------------------------------------------------------------------------
// 环境检测
// ---------------------------------------------------------------------------

export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
}

// ---------------------------------------------------------------------------
// 统一 invoke
// ---------------------------------------------------------------------------

/**
 * 统一的命令调用入口。
 * 桌面端走 Tauri invoke，网页端先尝试 CLI API，再回退到 Mock。
 */
export async function unifiedInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // 1. Tauri 桌面端
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }

  // 2. 网页端 — CLI API
  const cliResult = await tryCliApi<T>(cmd, args);
  if (cliResult !== undefined) return cliResult;

  // 3. 网页端 — Mock 回退
  const handler = mockHandlers[cmd];
  if (handler) {
    // 模拟网络延迟
    await new Promise((r) => setTimeout(r, 80));
    return handler(args) as T;
  }

  throw new Error(`[unifiedInvoke] 未找到命令处理器: ${cmd}`);
}

// ---------------------------------------------------------------------------
// 便捷方法（与 src/lib/tauri.ts 接口对齐）
// ---------------------------------------------------------------------------

export interface AppInfo {
  name: string;
  version: string;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_file: boolean;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export async function getAppInfo(): Promise<AppInfo> {
  return unifiedInvoke<AppInfo>('get_app_info');
}

export async function getDataDir(): Promise<string> {
  return unifiedInvoke<string>('get_data_dir');
}

export async function readFile(path: string): Promise<string> {
  return unifiedInvoke<string>('read_file', { path });
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return unifiedInvoke<void>('write_file', { path, contents });
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  return unifiedInvoke<FileEntry[]>('list_directory', { path });
}

export async function fileExists(path: string): Promise<boolean> {
  return unifiedInvoke<boolean>('file_exists', { path });
}

export async function createDirectory(path: string): Promise<void> {
  return unifiedInvoke<void>('create_directory', { path });
}

export async function deleteFile(path: string): Promise<void> {
  return unifiedInvoke<void>('delete_file', { path });
}

export async function openFileDialog(
  title?: string,
  filters?: FileFilter[]
): Promise<string | null> {
  return unifiedInvoke<string | null>('open_file_dialog', { title, filters });
}

export async function openDirectoryDialog(title?: string): Promise<string | null> {
  return unifiedInvoke<string | null>('open_directory_dialog', { title });
}

export async function saveFileDialog(
  title?: string,
  defaultPath?: string,
  filters?: FileFilter[]
): Promise<string | null> {
  return unifiedInvoke<string | null>('save_file_dialog', { title, defaultPath, filters });
}

export async function openUrl(url: string): Promise<void> {
  return unifiedInvoke<void>('open_url', { url });
}

export async function getEnvVar(name: string): Promise<string | null> {
  return unifiedInvoke<string | null>('get_env_var', { name });
}

export async function runCli(args: string[]): Promise<string> {
  return unifiedInvoke<string>('run_cli', { args });
}

export interface InitStatus {
  initialized: boolean;
  config_exists: boolean;
  keys_exists: boolean;
}

export async function checkInitStatus(): Promise<InitStatus> {
  return unifiedInvoke<InitStatus>('check_init_status');
}