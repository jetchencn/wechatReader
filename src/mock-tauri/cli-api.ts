/**
 * CLI API 代理 — 网页端通过 Vite 中间件调用 wechat-reader CLI。
 *
 * Vite 中间件在 vite.config.ts 中注册，提供 /api/cli/* 接口，
 * 将 HTTP 请求转发为本地 wechat-reader CLI 调用。
 */

let cliApiAvailable: boolean | null = null;

async function detectCliApi(): Promise<boolean> {
  try {
    const res = await fetch('/api/cli/ping', { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function checkCliApi(): Promise<boolean> {
  if (cliApiAvailable === true) return true;
  const available = await detectCliApi();
  cliApiAvailable = available;
  console.info(`[mock-tauri] CLI API available: ${available}`);
  return available;
}

// ---------------------------------------------------------------------------
// 命令 → CLI 参数映射
// ---------------------------------------------------------------------------

interface CliApiRequest {
  url: string;
  method?: string;
  body?: unknown;
}

function buildCliApiRequest(cmd: string, args?: Record<string, unknown>): CliApiRequest | null {
  switch (cmd) {
    // --- 基础文件操作 ---
    case 'read_file':
      return args?.path ? { url: `/api/cli/read-file?path=${encodeURIComponent(args.path as string)}` } : null;
    case 'write_file':
      return args?.path
        ? { url: '/api/cli/write-file', method: 'POST', body: { path: args.path, contents: args.contents } }
        : null;
    case 'file_exists':
      return args?.path ? { url: `/api/cli/file-exists?path=${encodeURIComponent(args.path as string)}` } : null;
    case 'list_directory':
      return args?.path ? { url: `/api/cli/list-directory?path=${encodeURIComponent(args.path as string)}` } : null;
    case 'create_directory':
      return args?.path
        ? { url: '/api/cli/create-directory', method: 'POST', body: { path: args.path } }
        : null;
    case 'delete_file':
      return args?.path
        ? { url: '/api/cli/delete-file', method: 'POST', body: { path: args.path } }
        : null;

    // --- CLI 命令 ---
    case 'run_cli':
      return { url: '/api/cli/run', method: 'POST', body: { args: args?.args ?? [] } };
    case 'check_init_status':
      return { url: '/api/cli/init-status' };

    // --- 微信数据查询 ---
    case 'get_sessions':
      return { url: `/api/cli/sessions?limit=${args?.limit ?? 20}&format=${args?.format ?? 'json'}` };
    case 'get_history':
      return {
        url: `/api/cli/history?chat=${encodeURIComponent((args?.chat_name ?? '') as string)}&limit=${args?.limit ?? 50}&format=${args?.format ?? 'json'}`,
      };
    case 'search_messages':
      return {
        url: `/api/cli/search?keyword=${encodeURIComponent((args?.keyword ?? '') as string)}&limit=${args?.limit ?? 20}&format=${args?.format ?? 'json'}`,
      };
    case 'get_contacts':
      return {
        url: `/api/cli/contacts?query=${encodeURIComponent((args?.query ?? '') as string)}&limit=${args?.limit ?? 50}&format=${args?.format ?? 'json'}`,
      };
    case 'get_favorites':
      return {
        url: `/api/cli/favorites?limit=${args?.limit ?? 20}&format=${args?.format ?? 'json'}${args?.fav_type ? `&fav_type=${args.fav_type}` : ''}${args?.query ? `&query=${encodeURIComponent(args.query as string)}` : ''}`,
      };
    case 'get_unread':
      return { url: `/api/cli/unread?limit=${args?.limit ?? 50}&format=${args?.format ?? 'json'}` };
    case 'get_new_messages':
      return { url: `/api/cli/new-messages?format=${args?.format ?? 'json'}` };
    case 'get_stats':
      return {
        url: `/api/cli/stats?chat=${encodeURIComponent((args?.chat_name ?? '') as string)}&format=${args?.format ?? 'json'}`,
      };

    // --- 应用信息 ---
    case 'get_app_info':
      return { url: '/api/cli/app-info' };
    case 'get_data_dir':
      return { url: '/api/cli/data-dir' };

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP 请求
// ---------------------------------------------------------------------------

function buildFetchOptions(request: CliApiRequest): RequestInit {
  if (!request.body) return { method: request.method || 'GET' };
  return {
    method: request.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  };
}

async function fetchCliApiResponse(request: CliApiRequest) {
  const url = new URL(request.url, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/cli/')) return undefined;
  const res = await fetch(new Request(url, buildFetchOptions(request)));
  if (!res.ok) return undefined;
  return res.json();
}

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

export async function tryCliApi<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  const request = buildCliApiRequest(cmd, args);
  if (!request) return undefined;
  if (!(await checkCliApi())) return undefined;

  try {
    const data = await fetchCliApiResponse(request);
    if (data === undefined) return undefined;
    // CLI API 返回格式：{ ok: true, data: ... }
    return (data?.data ?? data) as T;
  } catch (err) {
    console.warn(`[mock-tauri] CLI API 调用失败 (${cmd})，回退到 Mock:`, err);
    return undefined;
  }
}