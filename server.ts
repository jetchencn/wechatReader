import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { getDb, saveSubscriptions, loadSubscriptions, getSubscriptionIds } from './server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// CLI binary finder
// ---------------------------------------------------------------------------
function findCliBinary(): string | null {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    const candidate = path.join(dir, 'wechat-reader');
    if (fs.existsSync(candidate)) return candidate;
  }
  const projectRoot = path.resolve(__dirname);
  const candidates = [
    path.join(projectRoot, 'src-cli', 'target', 'release', 'wechat-reader'),
    path.join(projectRoot, 'src-cli', 'target', 'debug', 'wechat-reader'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function runCli(args: string[], timeoutMs = 60000): { stdout: string; stderr: string; exitCode: number } {
  const bin = findCliBinary();
  if (!bin) {
    return { stdout: '', stderr: 'wechat-reader CLI not found', exitCode: 1 };
  }
  try {
    const result = spawnSync(bin, args, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    const stderr = (result.stderr || '').trim();
    if (result.error) {
      return { stdout: '', stderr: `spawn error: ${result.error.message}`, exitCode: 1 };
    }
    if (result.status !== 0 && stderr) {
      console.error(`[runCli] CLI stderr for "${args.join(' ')}":`, stderr);
    }
    return {
      stdout: result.stdout || '',
      stderr: stderr,
      exitCode: result.status ?? 1,
    };
  } catch (err: unknown) {
    return { stdout: '', stderr: `spawn exception: ${String(err)}`, exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// Contact classification
// ---------------------------------------------------------------------------
interface RawContact {
  username: string;
  nick_name: string;
  remark: string;
  avatar?: string;
}

interface SessionItem {
  chat: string;
  username: string;
  is_group: boolean;
  unread: number;
  last_message: string;
  msg_type: string;
  sender: string;
  timestamp: number;
  time: string;
}

function classifyContact(c: RawContact): 'person' | 'group' | 'official_account' {
  if (c.username.includes('@chatroom')) return 'group';
  if (c.username.startsWith('gh_')) return 'official_account';
  return 'person';
}

function getDisplayName(c: RawContact): string {
  if (c.remark && c.remark.trim()) return c.remark;
  if (c.nick_name && c.nick_name.trim()) return c.nick_name;
  return c.username;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // -----------------------------------------------------------------------
  // API: fetch contacts from CLI (merge contacts + sessions)
  // -----------------------------------------------------------------------
  app.get("/api/contacts", (req, res) => {
    const query = (req.query.query as string) || '';
    const limit = (req.query.limit as string) || '5000';

    // Fetch contacts
    const contactsArgs = ['contacts', '--limit', limit, '--format', 'json'];
    if (query) contactsArgs.push('--query', query);
    const contactsResult = runCli(contactsArgs);

    // Fetch sessions (to get groups that may not appear in contacts)
    const sessionsResult = runCli(['sessions', '--limit', '500', '--format', 'json']);

    try {
      // Parse contacts
      let rawContacts: RawContact[] = [];
      if (contactsResult.exitCode === 0) {
        rawContacts = JSON.parse(contactsResult.stdout);
      }

      // Parse sessions
      let sessions: SessionItem[] = [];
      if (sessionsResult.exitCode === 0) {
        sessions = JSON.parse(sessionsResult.stdout);
      }

      // Build a map from contacts
      const contactMap = new Map<string, RawContact>();
      for (const c of rawContacts) {
        contactMap.set(c.username, c);
      }

      // Merge sessions: add groups that are not in contacts
      for (const s of sessions) {
        if (s.is_group && !contactMap.has(s.username)) {
          contactMap.set(s.username, {
            username: s.username,
            nick_name: s.chat,
            remark: '',
            avatar: '',
          });
        }
      }

      // Classify and build result
      const classified = Array.from(contactMap.values()).map((c) => ({
        id: c.username,
        username: c.username,
        name: getDisplayName(c),
        nick_name: c.nick_name,
        remark: c.remark,
        avatar: c.avatar || '',
        type: classifyContact(c),
      }));

      res.json({ ok: true, data: classified });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'Failed to parse CLI output: ' + String(e) });
    }
  });

  // -----------------------------------------------------------------------
  // API: subscriptions CRUD
  // -----------------------------------------------------------------------
  app.get("/api/subscriptions", (_req, res) => {
    try {
      const subs = loadSubscriptions();
      res.json({ ok: true, data: subs });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post("/api/subscriptions", (req, res) => {
    try {
      const { contacts } = req.body;
      if (!Array.isArray(contacts)) {
        res.status(400).json({ ok: false, error: 'contacts must be an array' });
        return;
      }
      saveSubscriptions(contacts);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.get("/api/subscription-ids", (_req, res) => {
    try {
      const ids = getSubscriptionIds();
      res.json({ ok: true, data: ids });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // -----------------------------------------------------------------------
  // Unread sessions cache
  // -----------------------------------------------------------------------
  let unreadChatNamesCache: Set<string> = new Set();
  let unreadCacheTime = 0;
  const UNREAD_CACHE_TTL = 30000; // 30 seconds

  function getUnreadChatNames(): Set<string> {
    const now = Date.now();
    if (now - unreadCacheTime < UNREAD_CACHE_TTL) {
      return unreadChatNamesCache;
    }
    try {
      const result = runCli(['unread', '--limit', '500', '--format', 'json']);
      if (result.exitCode === 0) {
        const parsed = JSON.parse(result.stdout);
        const names = new Set<string>();
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.chat) names.add(item.chat);
          }
        }
        unreadChatNamesCache = names;
        unreadCacheTime = now;
      }
    } catch { /* ignore */ }
    return unreadChatNamesCache;
  }

  // -----------------------------------------------------------------------
  // API: fetch messages from CLI via search command
  // -----------------------------------------------------------------------
  app.get("/api/messages", (req, res) => {
    try {
      const startTime = (req.query['start-time'] as string) || '';
      const endTime = (req.query['end-time'] as string) || '';
      const limit = (req.query.limit as string) || '5000';
      const offset = (req.query.offset as string) || '0';
      const keyword = (req.query.keyword as string) || '';
      const msgType = (req.query['msg-type'] as string) || '';

      // Support multiple --chat params (Express parses ?chat=a&chat=b as array)
      let chatNames: string[] = [];
      if (Array.isArray(req.query.chat)) {
        chatNames = req.query.chat as string[];
      } else if (typeof req.query.chat === 'string') {
        chatNames = [req.query.chat];
      }

      // Use empty keyword so CLI uses limit+offset as batch size (no 500 cap)
      const args = ['search', keyword, '--limit', limit, '--offset', offset, '--format', 'json'];
      if (startTime) args.push('--start-time', startTime);
      if (endTime) args.push('--end-time', endTime);
      for (const cn of chatNames) {
        args.push('--chat', cn);
      }
      if (msgType) args.push('--msg-type', msgType);

      console.log('[API /api/messages] running CLI:', args.join(' '));

      const result = runCli(args, 120000); // 2 min timeout for large group queries

      if (result.exitCode !== 0) {
        console.error('[API /api/messages] CLI failed:', result.stderr);
        res.json({ ok: false, error: result.stderr || 'CLI failed' });
        return;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(result.stdout);
      } catch (parseErr) {
        console.error('[API /api/messages] JSON parse error, stdout preview:', result.stdout.slice(0, 500));
        res.json({ ok: false, error: 'Failed to parse CLI output: ' + String(parseErr) });
        return;
      }

      // Get unread chat names for isRead status
      const unreadChats = getUnreadChatNames();

      // Transform CLI results into WeChatMessage format
      const messages: {
        id: string;
        type: string;
        contactId: string;
        senderName: string;
        contentType: string;
        content: string;
        timestamp: number;
        isRead: boolean;
        metadata?: { url?: string };
      }[] = [];

      if (Array.isArray(parsed.results)) {
        for (const line of parsed.results) {
          if (typeof line !== 'string') continue;
          // Parse format:
          //   Person chat: "[2025-01-15 14:30] [ChatName] message content"
          //   Group chat:  "[2025-01-15 14:30] [ChatName] SenderName: message content"
          const match = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \[([^\]]+)\]\s*([\s\S]+)$/);
          if (!match) continue;

          const timeStr = match[1];
          const chatName = match[2];
          const rest = match[3];

          // Parse time as local time (WeChat DB stores local-time-based timestamps)
          // new Date("2025-01-15 14:30") is non-standard; parse manually to ensure local time
          const tsMatch = timeStr.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
          let timestamp = 0;
          if (tsMatch) {
            const [, y, m, d, h, min] = tsMatch;
            timestamp = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min)).getTime();
          } else {
            timestamp = new Date(timeStr).getTime();
          }
          if (isNaN(timestamp)) continue;

          const isGroup = chatName.includes('群') || chatName.includes('group');

          // Extract sender for all chats (CLI now outputs sender for person chats too)
          // Format: "SenderName: message content" or just "message content"
          let sender = '';
          let content = rest;
          const senderMatch = rest.match(/^([^:]+):\s*([\s\S]*)$/);
          if (senderMatch) {
            sender = senderMatch[1].trim();
            content = senderMatch[2];
          }

          // Detect content type from content markers
          let contentType = 'text';
          if (content.startsWith('[图片]')) contentType = 'image';
          else if (content.startsWith('[语音]')) contentType = 'voice';
          else if (content.startsWith('[视频]')) contentType = 'video';
          else if (content.startsWith('[文件]')) contentType = 'file';
          else if (content.startsWith('[链接]')) contentType = 'link';
          else if (content.startsWith('[链接/文件]')) contentType = 'link';
          else if (content.startsWith('[小程序]')) contentType = 'link';

          // Determine isRead: check if this chat has unread messages
          const isRead = !unreadChats.has(chatName);

          messages.push({
            id: `msg-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
            type: isGroup ? 'group' : 'person',
            contactId: chatName,
            senderName: sender || chatName,
            contentType: contentType,
            content: content,
            timestamp: timestamp,
            isRead: isRead,
          });
        }
      }

      console.log(`[API /api/messages] returned ${messages.length} messages`);

      res.json({
        ok: true,
        data: {
          scope: parsed.scope || '',
          count: messages.length,
          offset: Number(offset),
          limit: Number(limit),
          messages: messages,
        },
      });
    } catch (e) {
      console.error('[API /api/messages] exception:', e);
      res.status(500).json({ ok: false, error: 'Failed to fetch messages: ' + String(e) });
    }
  });

  // -----------------------------------------------------------------------
  // API: fetch favorite articles from CLI (local downloaded articles)
  // -----------------------------------------------------------------------
  app.get("/api/articles", (req, res) => {
    try {
      const limit = (req.query.limit as string) || '5000';
      const query = (req.query.query as string) || '';
      const localDir = (req.query.local_dir as string) || '';

      // If localDir is set, scan the directory for article files
      if (localDir && fs.existsSync(localDir)) {
        try {
          const files = fs.readdirSync(localDir);
          const articles: {
            id: string;
            title: string;
            digest: string;
            sourceChat: string;
            author?: string;
            publishTime: number;
            url?: string;
          }[] = [];

          for (const file of files) {
            const fullPath = path.join(localDir, file);
            const stat = fs.statSync(fullPath);
            if (!stat.isFile()) continue;
            const ext = path.extname(file).toLowerCase();
            if (!['.html', '.md', '.txt', '.json'].includes(ext)) continue;

            const title = path.basename(file, ext);
            articles.push({
              id: `local-${file}`,
              title: title,
              digest: '',
              sourceChat: '本地文章',
              author: '',
              publishTime: stat.mtimeMs,
              url: `file://${fullPath}`,
            });
          }

          let filtered = articles;
          if (query) {
            const q = query.toLowerCase();
            filtered = articles.filter(a => a.title.toLowerCase().includes(q));
          }

          const limited = filtered.slice(0, parseInt(limit, 10));

          res.json({
            ok: true,
            data: { count: limited.length, articles: limited },
          });
          return;
        } catch (err: unknown) {
          res.status(500).json({ ok: false, error: String(err) });
          return;
        }
      }

      // Fallback: use CLI favorites command
      const args = ['favorites', '--fav-type', 'article', '--limit', limit, '--format', 'json'];
      if (query) args.push('--query', query);

      console.log('[API /api/articles] running CLI:', args.join(' '));

      const result = runCli(args);

      if (result.exitCode !== 0) {
        console.error('[API /api/articles] CLI failed:', result.stderr);
        res.json({ ok: false, error: result.stderr || 'CLI failed' });
        return;
      }

      const parsed = JSON.parse(result.stdout);
      const articles: {
        id: string;
        title: string;
        digest: string;
        sourceChat: string;
        author?: string;
        publishTime: number;
      }[] = [];

      if (Array.isArray(parsed.favorites)) {
        for (const fav of parsed.favorites) {
          // summary format: "title - description" or just "title"
          const summary = fav.summary || '';
          const separatorIdx = summary.indexOf(' - ');
          const title = separatorIdx > 0 ? summary.substring(0, separatorIdx) : summary;
          const digest = separatorIdx > 0 ? summary.substring(separatorIdx + 3) : '';

          articles.push({
            id: `fav-${fav.id}`,
            title: title,
            digest: digest,
            sourceChat: fav.source_chat || '',
            author: fav.from || undefined,
            publishTime: fav.time ? new Date(fav.time).getTime() : 0,
          });
        }
      }

      res.json({
        ok: true,
        data: {
          count: articles.length,
          articles: articles,
        },
      });
    } catch (e) {
      console.error('[API /api/articles] exception:', e);
      res.status(500).json({ ok: false, error: 'Failed to fetch articles: ' + String(e) });
    }
  });

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
