/**
 * CLI API Vite 插件 — 网页端通过 HTTP 调用 wechat-reader CLI。
 *
 * 在 Vite dev server 中注册 /api/cli/* 路由，
 * 将前端请求转发为本地 wechat-reader CLI 调用或直接文件操作。
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin } from 'vite';
import { spawnSync } from 'child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmdirSync,
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// 查找 CLI 二进制
// ---------------------------------------------------------------------------

function findCliBinary(): string | null {
  // 1. PATH 环境变量
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    const candidate = path.join(dir, 'wechat-reader');
    if (existsSync(candidate)) return candidate;
  }

  // 2. 项目 src-cli 目录
  const projectRoot = path.resolve(__dirname, '..', '..');
  const candidates = [
    path.join(projectRoot, 'src-cli', 'target', 'release', 'wechat-reader'),
    path.join(projectRoot, 'src-cli', 'target', 'debug', 'wechat-reader'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return null;
}

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const bin = findCliBinary();
  if (!bin) {
    return { stdout: '', stderr: 'wechat-reader CLI 未找到。请先构建: cd src-cli && cargo build --release', exitCode: 1 };
  }
  try {
    const result = spawnSync(bin, args, {
      timeout: 30000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.status ?? 1,
    };
  } catch (err: unknown) {
    return { stdout: '', stderr: String(err), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// JSON 响应工具
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, payload: unknown, statusCode = 200): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(payload));
}

function sendError(res: ServerResponse, message: string, statusCode = 500): void {
  sendJson(res, { ok: false, error: message }, statusCode);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}

// ---------------------------------------------------------------------------
// 路由处理
// ---------------------------------------------------------------------------

async function handleCliApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (!url.pathname.startsWith('/api/cli/')) return false;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }

  const route = url.pathname.replace('/api/cli/', '');

  try {
    switch (route) {
      // --- 健康检查 ---
      case 'ping':
        sendJson(res, { ok: true, cliAvailable: !!findCliBinary() });
        return true;

      // --- 应用信息 ---
      case 'app-info':
        sendJson(res, { ok: true, data: { name: 'WechatReader', version: '0.1.0' } });
        return true;

      case 'data-dir': {
        const dataDir = path.join(os.homedir(), '.wechat-reader-data');
        sendJson(res, { ok: true, data: dataDir });
        return true;
      }

      // --- 文件操作 ---
      case 'read-file': {
        const filePath = url.searchParams.get('path');
        if (!filePath) { sendError(res, '缺少 path 参数', 400); return true; }
        if (!existsSync(filePath)) { sendError(res, `文件不存在: ${filePath}`, 404); return true; }
        sendJson(res, { ok: true, data: readFileSync(filePath, 'utf-8') });
        return true;
      }

      case 'write-file': {
        if (req.method !== 'POST') { sendError(res, '需要 POST', 405); return true; }
        const body = JSON.parse(await readBody(req));
        if (!body.path) { sendError(res, '缺少 path', 400); return true; }
        mkdirSync(path.dirname(body.path), { recursive: true });
        writeFileSync(body.path, body.contents ?? '', 'utf-8');
        sendJson(res, { ok: true });
        return true;
      }

      case 'file-exists': {
        const filePath = url.searchParams.get('path');
        if (!filePath) { sendError(res, '缺少 path 参数', 400); return true; }
        sendJson(res, { ok: true, data: existsSync(filePath) });
        return true;
      }

      case 'list-directory': {
        const dirPath = url.searchParams.get('path');
        if (!dirPath) { sendError(res, '缺少 path 参数', 400); return true; }
        if (!existsSync(dirPath)) { sendError(res, `目录不存在: ${dirPath}`, 404); return true; }
        const entries = readdirSync(dirPath).map((name) => {
          const full = path.join(dirPath, name);
          const stat = statSync(full);
          return { name, path: full, is_dir: stat.isDirectory(), is_file: stat.isFile() };
        });
        sendJson(res, { ok: true, data: entries });
        return true;
      }

      case 'create-directory': {
        if (req.method !== 'POST') { sendError(res, '需要 POST', 405); return true; }
        const body = JSON.parse(await readBody(req));
        if (!body.path) { sendError(res, '缺少 path', 400); return true; }
        mkdirSync(body.path, { recursive: true });
        sendJson(res, { ok: true });
        return true;
      }

      case 'delete-file': {
        if (req.method !== 'POST') { sendError(res, '需要 POST', 405); return true; }
        const body = JSON.parse(await readBody(req));
        if (!body.path) { sendError(res, '缺少 path', 400); return true; }
        if (!existsSync(body.path)) { sendError(res, '文件不存在', 404); return true; }
        const stat = statSync(body.path);
        if (stat.isDirectory()) rmdirSync(body.path, { recursive: true });
        else unlinkSync(body.path);
        sendJson(res, { ok: true });
        return true;
      }

      // --- CLI 命令 ---
      case 'run': {
        if (req.method !== 'POST') { sendError(res, '需要 POST', 405); return true; }
        const body = JSON.parse(await readBody(req));
        const args = body.args ?? [];
        const result = runCli(args);
        if (result.exitCode !== 0) {
          sendJson(res, { ok: false, error: result.stderr || result.stdout }, 500);
        } else {
          sendJson(res, { ok: true, data: result.stdout });
        }
        return true;
      }

      case 'init-status': {
        const home = os.homedir();
        const stateDir = path.join(home, '.wechat-reader');
        const configExists = existsSync(path.join(stateDir, 'config.json'));
        const keysExists = existsSync(path.join(stateDir, 'all_keys.json'));
        sendJson(res, {
          ok: true,
          data: { initialized: configExists && keysExists, config_exists: configExists, keys_exists: keysExists },
        });
        return true;
      }

      // --- 微信数据查询（转发 CLI） ---
      case 'sessions': {
        const limit = url.searchParams.get('limit') ?? '20';
        const format = url.searchParams.get('format') ?? 'json';
        const result = runCli(['sessions', '--limit', limit, '--format', format]);
        if (result.exitCode !== 0) {
          sendJson(res, { ok: false, error: result.stderr }, 500);
        } else {
          try {
            sendJson(res, { ok: true, data: JSON.parse(result.stdout) });
          } catch {
            sendJson(res, { ok: true, data: result.stdout });
          }
        }
        return true;
      }

      case 'history': {
        const chat = url.searchParams.get('chat') ?? '';
        const limit = url.searchParams.get('limit') ?? '50';
        const format = url.searchParams.get('format') ?? 'json';
        if (!chat) { sendError(res, '缺少 chat 参数', 400); return true; }
        const result = runCli(['history', chat, '--limit', limit, '--format', format]);
        if (result.exitCode !== 0) {
          sendJson(res, { ok: false, error: result.stderr }, 500);
        } else {
          try {
            sendJson(res, { ok: true, data: JSON.parse(result.stdout) });
          } catch {
            sendJson(res, { ok: true, data: result.stdout });
          }
        }
        return true;
      }

      case 'search': {
        const keyword = url.searchParams.get('keyword') ?? '';
        const limit = url.searchParams.get('limit') ?? '20';
        const format = url.searchParams.get('format') ?? 'json';
        if (!keyword) { sendError(res, '缺少 keyword 参数', 400); return true; }
        const result = runCli(['search', keyword, '--limit', limit, '--format', format]);
        if (result.exitCode !== 0) {
          sendJson(res, { ok: false, error: result.stderr }, 500);
        } else {
          try {
            sendJson(res, { ok: true, data: JSON.parse(result.stdout) });
          } catch {
            sendJson(res, { ok: true, data: result.stdout });
          }
        }
        return true;
      }

      case 'contacts': {
        const query = url.searchParams.get('query') ?? '';
        const limit = url.searchParams.get('limit') ?? '50';
        const format = url.searchParams.get('format') ?? 'json';
        const args = ['contacts', '--limit', limit, '--format', format];
        if (query) args.push('--query', query);
        const result = runCli(args);
        if (result.exitCode !== 0) {
          sendJson(res, { ok: false, error: result.stderr }, 500);
        } else {
          try {
            sendJson(res, { ok: true, data: JSON.parse(result.stdout) });
          } catch {
            sendJson(res, { ok: true, data: result.stdout });
          }
        }
        return true;
      }

      case 'favorites': {
        const limit = url.searchParams.get('limit') ?? '20';
        const format = url.searchParams.get('format') ?? 'json';
        const favType = url.searchParams.get('fav_type');
        const query = url.searchParams.get('query');
        const args = ['favorites', '--limit', limit, '--format', format];
        if (favType) args.push('--fav-type', favType);
        if (query) args.push('--query', query);
        const result = runCli(args);
        if (result.exitCode !== 0) {
          sendJson(res, { ok: false, error: result.stderr }, 500);
        } else {
          try {
            sendJson(res, { ok: true, data: JSON.parse(result.stdout) });
          } catch {
            sendJson(res, { ok: true, data: result.stdout });
          }
        }
        return true;
      }

      case 'unread': {
        const limit = url.searchParams.get('limit') ?? '50';
        const format = url.searchParams.get('format') ?? 'json';
        const result = runCli(['unread', '--limit', limit, '--format', format]);
        if (result.exitCode !== 0) {
          sendJson(res, { ok: false, error: result.stderr }, 500);
        } else {
          try {
            sendJson(res, { ok: true, data: JSON.parse(result.stdout) });
          } catch {
            sendJson(res, { ok: true, data: result.stdout });
          }
        }
        return true;
      }

      case 'new-messages': {
        const format = url.searchParams.get('format') ?? 'json';
        const result = runCli(['new-messages', '--format', format]);
        if (result.exitCode !== 0) {
          sendJson(res, { ok: false, error: result.stderr }, 500);
        } else {
          try {
            sendJson(res, { ok: true, data: JSON.parse(result.stdout) });
          } catch {
            sendJson(res, { ok: true, data: result.stdout });
          }
        }
        return true;
      }

      case 'stats': {
        const chat = url.searchParams.get('chat') ?? '';
        const format = url.searchParams.get('format') ?? 'json';
        if (!chat) { sendError(res, '缺少 chat 参数', 400); return true; }
        const result = runCli(['stats', chat, '--format', format]);
        if (result.exitCode !== 0) {
          sendJson(res, { ok: false, error: result.stderr }, 500);
        } else {
          try {
            sendJson(res, { ok: true, data: JSON.parse(result.stdout) });
          } catch {
            sendJson(res, { ok: true, data: result.stdout });
          }
        }
        return true;
      }

      default:
        sendError(res, `未知 API: ${route}`, 404);
        return true;
    }
  } catch (err: unknown) {
    sendError(res, err instanceof Error ? err.message : '内部错误');
    return true;
  }
}

// ---------------------------------------------------------------------------
// Vite 插件导出
// ---------------------------------------------------------------------------

export function cliApiPlugin(): Plugin {
  return {
    name: 'cli-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (await handleCliApi(req, res)) return;
        next();
      });
    },
  };
}