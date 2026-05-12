/**
 * Mock 命令处理器 — 网页端无 CLI 时的回退数据。
 * 每个 handler 模拟一个 Tauri 后端命令的返回值。
 *
 * 网页端使用 localStorage 持久化文件操作（read_file/write_file 等），
 * 确保刷新页面后数据不丢失。
 */

import type { InitStatus } from './index';

// ---------------------------------------------------------------------------
// localStorage 持久化模拟文件系统
// ---------------------------------------------------------------------------

const LS_PREFIX = 'wechat-reader:fs:';
const LS_DATA_DIR = 'wechat-reader:data_dir';

function lsGet(key: string): string | null {
  try { return localStorage.getItem(LS_PREFIX + key); } catch { return null; }
}

function lsSet(key: string, value: string): void {
  try { localStorage.setItem(LS_PREFIX + key, value); } catch { /* quota exceeded */ }
}

function lsRemove(key: string): void {
  try { localStorage.removeItem(LS_PREFIX + key); } catch { /* ignore */ }
}

function lsHas(key: string): boolean {
  try { return localStorage.getItem(LS_PREFIX + key) !== null; } catch { return false; }
}

function getMockDataDir(): string {
  try {
    const saved = localStorage.getItem(LS_DATA_DIR);
    return saved || '__web_storage__';
  } catch {
    return '__web_storage__';
  }
}

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mockHandlers: Record<string, (args?: any) => any> = {
  // --- 应用信息 ---
  get_app_info: () => ({ name: 'WechatReader', version: '0.1.0' }),
  get_data_dir: () => getMockDataDir(),

  // --- 文件操作（localStorage 持久化） ---
  read_file: (args: { path: string }) => {
    const content = lsGet(args.path);
    if (content === null) throw new Error(`文件不存在: ${args.path}`);
    return content;
  },
  write_file: (args: { path: string; contents: string }) => {
    lsSet(args.path, args.contents);
    return null;
  },
  file_exists: (args: { path: string }) => lsHas(args.path),
  list_directory: () => [],
  create_directory: () => null,
  delete_file: (args: { path: string }) => {
    lsRemove(args.path);
    return null;
  },

  // --- 对话框（网页端不支持原生对话框） ---
  open_file_dialog: () => null,
  open_directory_dialog: () => null,
  save_file_dialog: () => null,

  // --- 其他 ---
  open_url: (args: { url: string }) => {
    window.open(args.url, '_blank');
    return null;
  },
  get_env_var: () => null,

  // --- CLI 命令 ---
  run_cli: (args: { args: string[] }) => {
    const cmd = args?.args?.[0];
    if (cmd === 'sessions') return JSON.stringify([]);
    if (cmd === 'contacts') return JSON.stringify([]);
    if (cmd === 'history') return JSON.stringify([]);
    if (cmd === 'favorites') return JSON.stringify({ count: 0, favorites: [] });
    if (cmd === 'unread') return JSON.stringify([]);
    if (cmd === 'new-messages') return JSON.stringify({ first_call: true, messages: [] });
    if (cmd === 'stats') return JSON.stringify({ total: 0 });
    return JSON.stringify({ result: 'ok' });
  },
  check_init_status: (): InitStatus => ({
    initialized: true,
    config_exists: true,
    keys_exists: true,
  }),

  // --- 微信数据查询 ---
  get_sessions: () => ({ sessions: [] }),
  get_history: () => ({ messages: [], count: 0 }),
  search_messages: () => ({ results: [], count: 0 }),
  get_contacts: () => ({ contacts: [] }),
  get_favorites: () => ({ count: 0, favorites: [] }),
  get_unread: () => [],
  get_new_messages: () => ({ first_call: true, messages: [], unread_count: 0 }),
  get_stats: () => ({ total: 0, by_type: {} }),
};