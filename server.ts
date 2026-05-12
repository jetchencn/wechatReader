import express from "express";
import { createServer } from "http";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';
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

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ---------------------------------------------------------------------------
// WeChat V2 encrypted image format constants
// ---------------------------------------------------------------------------
const V2_MAGIC_FULL = Buffer.from([0x07, 0x08, 0x56, 0x32, 0x08, 0x07]); // \x07\x08V2\x08\x07
const V2_AES_KEY = Buffer.from('35a5a4e22c196bde', 'utf8'); // 16-byte AES-128-ECB key
const V2_XOR_KEY = 0x11;

/**
 * Detect image MIME type from a raw (decrypted) header buffer.
 * Supports standard image formats and WeChat-specific wxgf (HEVC) format.
 */
function detectImageMimeFromHeader(header: Buffer): string | null {
  if (header.length < 4) return null;
  // JPEG
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return 'image/jpeg';
  // PNG
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return 'image/png';
  // GIF
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) return 'image/gif';
  // BMP
  if (header[0] === 0x42 && header[1] === 0x4D) return 'image/bmp';
  // WebP: RIFF....WEBP
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
      && header.length >= 12 && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) {
    return 'image/webp';
  }
  // WeChat wxgf (HEVC) format: "wxgf" magic at start
  if (header[0] === 0x77 && header[1] === 0x78 && header[2] === 0x67 && header[3] === 0x66) {
    return 'image/wxgf';
  }
  return null;
}

/**
 * Remove PKCS7 padding from a decrypted AES block.
 */
function pkcs7Unpad(buf: Buffer): Buffer {
  if (buf.length === 0) return buf;
  const padLen = buf[buf.length - 1];
  if (padLen < 1 || padLen > 16) return buf;
  for (let i = buf.length - padLen; i < buf.length; i++) {
    if (buf[i] !== padLen) return buf; // invalid padding, return as-is
  }
  return buf.subarray(0, buf.length - padLen);
}

/**
 * Decrypt a WeChat V2 encrypted image.
 * V2 format: [6-byte magic][4-byte aes_size][4-byte xor_size][1-byte unknown][AES-ECB data][raw data][XOR data]
 *
 * Python alignment: aligned_aes_size -= ~(~aligned_aes_size % 16)
 * This rounds up to next 16-byte boundary AND adds 16 if already aligned (for PKCS7 padding room).
 */
function decryptV2(buf: Buffer): { data: Buffer; mime: string } | null {
  if (buf.length < 15) return null;

  // Check V2 magic signature
  if (!V2_MAGIC_FULL.equals(buf.subarray(0, 6))) return null;

  // Read aes_size and xor_size (little-endian uint32)
  const aesSize = buf.readUInt32LE(6);
  const xorSize = buf.readUInt32LE(10);

  if (aesSize === 0 || xorSize === 0) return null;

  // Python alignment: aligned_aes_size -= ~(~aligned_aes_size % 16)
  // In Python: ~x = -(x+1), % always returns non-negative for positive divisor
  // Result: round up to next 16 boundary, and if already aligned, add 16 (for PKCS7 padding)
  const pyNot = -aesSize - 1;
  const pyMod = ((pyNot % 16) + 16) % 16;  // simulate Python's always-nonnegative modulo
  const pyNotMod = -pyMod - 1;
  const alignedAesSize = aesSize - pyNotMod;

  const dataOffset = 15;
  if (dataOffset + alignedAesSize > buf.length) return null;

  // Decrypt AES-ECB portion (disable auto-padding, we handle PKCS7 manually)
  const aesData = buf.subarray(dataOffset, dataOffset + alignedAesSize);
  let decAes: Buffer;
  try {
    const decipher = crypto.createDecipheriv('aes-128-ecb', V2_AES_KEY, null);
    decipher.setAutoPadding(false);
    const decRaw = Buffer.concat([decipher.update(aesData), decipher.final()]);
    decAes = pkcs7Unpad(decRaw);
  } catch {
    return null;
  }

  // Extract raw (unencrypted) middle portion
  let offset = dataOffset + alignedAesSize;
  const rawEnd = buf.length - xorSize;
  const rawData = offset < rawEnd ? buf.subarray(offset, rawEnd) : Buffer.alloc(0);

  // Decrypt XOR-encrypted tail portion
  offset = rawEnd;
  const xorData = buf.subarray(offset);
  const decXor = Buffer.alloc(xorData.length);
  for (let i = 0; i < xorData.length; i++) {
    decXor[i] = xorData[i] ^ V2_XOR_KEY;
  }

  // Combine all parts
  const decrypted = Buffer.concat([decAes, rawData, decXor]);

  // Detect format from decrypted header
  const mime = detectImageMimeFromHeader(decrypted.subarray(0, Math.min(16, decrypted.length)));
  if (!mime) return null;

  return { data: decrypted, mime };
}

/**
 * Decode a WeChat .dat image file.
 * Supports two encryption formats:
 * 1. V2 format: AES-ECB + XOR hybrid encryption (magic: \x07\x08V2\x08\x07)
 * 2. Legacy XOR format: single-byte XOR of entire file
 */
function decodeWechatDat(buf: Buffer): { data: Buffer; mime: string } | null {
  if (buf.length < 10) return null;

  // Try V2 decryption first (newer WeChat versions)
  const v2Result = decryptV2(buf);
  if (v2Result) return v2Result;

  // Fall back to legacy XOR decryption
  const firstByte = buf[0];

  // Helper: try to find a valid XOR key by checking the decoded header
  function tryKey(key: number): { mime: string } | null {
    const b0 = buf[0] ^ key;
    const b1 = buf[1] ^ key;
    const b2 = buf[2] ^ key;
    const b3 = buf[3] ^ key;
    const b4 = buf[4] ^ key;
    const b5 = buf[5] ^ key;
    const b6 = buf[6] ^ key;
    const b7 = buf[7] ^ key;

    // JPEG: FF D8 FF E0/E1/DB/C0/C4/FE...
    if (b0 === 0xFF && b1 === 0xD8 && b2 === 0xFF) {
      if (b3 >= 0xE0 && b3 <= 0xEF || b3 === 0xDB || b3 >= 0xC0 && b3 <= 0xC4 || b3 === 0xFE) {
        return { mime: 'image/jpeg' };
      }
      return { mime: 'image/jpeg' };
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47
        && b4 === 0x0D && b5 === 0x0A && b6 === 0x1A && b7 === 0x0A) {
      return { mime: 'image/png' };
    }
    if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47) {
      return { mime: 'image/png' };
    }
    // GIF: 47 49 46 38 39 61 or 47 49 46 38 37 61
    if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38
        && (b4 === 0x39 || b4 === 0x37) && b5 === 0x61) {
      return { mime: 'image/gif' };
    }
    // BMP: 42 4D
    if (b0 === 0x42 && b1 === 0x4D && buf.length >= 6) {
      const decodedSize = (buf[2] ^ key) | ((buf[3] ^ key) << 8) | ((buf[4] ^ key) << 16) | ((buf[5] ^ key) << 24);
      if (decodedSize > 0 && Math.abs(decodedSize - buf.length) < buf.length * 0.15) {
        return { mime: 'image/bmp' };
      }
    }
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
      const w0 = buf[8] ^ key;
      const w1 = buf[9] ^ key;
      const w2 = buf[10] ^ key;
      const w3 = buf[11] ^ key;
      if (w0 === 0x57 && w1 === 0x45 && w2 === 0x42 && w3 === 0x50) {
        return { mime: 'image/webp' };
      }
    }
    // HEIC/HEIF: 00 00 00 XX 66 74 79 70 (ftyp box)
    if (b4 === 0x66 && b5 === 0x74 && b6 === 0x79 && b7 === 0x70) {
      return { mime: 'image/heic' };
    }
    return null;
  }

  let xorKey = 0;
  let mime = 'image/jpeg';

  // Strategy 1: Derive key from first byte + expected header
  const candidates = [
    firstByte ^ 0xFF,  // JPEG key
    firstByte ^ 0x89,  // PNG key
    firstByte ^ 0x47,  // GIF key
    firstByte ^ 0x42,  // BMP key
    firstByte ^ 0x52,  // WebP key
  ];

  for (const key of candidates) {
    const result = tryKey(key);
    if (result) {
      xorKey = key;
      mime = result.mime;
      break;
    }
  }

  // Strategy 2: Try common known WeChat XOR keys
  if (xorKey === 0) {
    const fallbackKeys = [0x38, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0x36, 0x37, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F];
    for (const key of fallbackKeys) {
      const result = tryKey(key);
      if (result) {
        xorKey = key;
        mime = result.mime;
        break;
      }
    }
  }

  // Strategy 3: Brute-force search for any key that produces a valid header
  if (xorKey === 0) {
    for (let key = 0; key < 256; key++) {
      const result = tryKey(key);
      if (result) {
        xorKey = key;
        mime = result.mime;
        break;
      }
    }
  }

  // Strategy 4: Try XOR with first byte itself (some WeChat versions)
  if (xorKey === 0) {
    const result = tryKey(firstByte);
    if (result) {
      xorKey = firstByte;
      mime = result.mime;
    }
  }

  if (xorKey === 0) return null;

  // XOR all bytes with the key
  const decoded = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    decoded[i] = buf[i] ^ xorKey;
  }
  return { data: decoded, mime };
}

/**
 * Detect image MIME type from raw buffer (without XOR decoding).
 * Some WeChat .dat files are actually just renamed standard image files.
 */
function detectImageMimeFromRaw(buf: Buffer): string | null {
  if (buf.length < 8) return null;
  const b0 = buf[0], b1 = buf[1], b2 = buf[2], b3 = buf[3];
  // JPEG
  if (b0 === 0xFF && b1 === 0xD8 && b2 === 0xFF) return 'image/jpeg';
  // PNG
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47) return 'image/png';
  // GIF
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) return 'image/gif';
  // BMP
  if (b0 === 0x42 && b1 === 0x4D) return 'image/bmp';
  // WebP
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) return 'image/webp';
  return null;
}

function getDisplayName(c: RawContact): string {
  if (c.remark && c.remark.trim()) return c.remark;
  if (c.nick_name && c.nick_name.trim()) return c.nick_name;
  return c.username;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json());

  // -----------------------------------------------------------------------
  // API: resolve image by local_id
  // Queries CLI for raw message content, extracts md5, finds .dat file
  // -----------------------------------------------------------------------
  app.get("/api/image", async (req, res) => {
    const localId = req.query.local_id as string;
    const chatName = req.query.chat as string;
    if (!localId) {
      res.status(400).json({ ok: false, error: 'local_id parameter required' });
      return;
    }

    // Try to find image via CLI media resolution first
    if (chatName) {
      const cliArgs = ['history', chatName, '--limit', '500', '--msg-type', 'image', '--media', '--format', 'json'];
      const result = runCli(cliArgs, 30000);
      if (result.exitCode === 0) {
        try {
          const parsed = JSON.parse(result.stdout);
          const messages: string[] = parsed.messages || [];
          const targetMsg = messages.find((m: string) => m.includes(`local_id=${localId})`));
          if (targetMsg) {
            const pathMatch = targetMsg.match(/\[图片\]\s+((?:\/|\.\.\/|\w:\\)[^\s)]+?)(?:\s*\(文件不存在\))?/);
            if (pathMatch && fs.existsSync(pathMatch[1])) {
              res.redirect(`/api/file?path=${encodeURIComponent(pathMatch[1])}`);
              return;
            }
          }
        } catch { /* continue to fallback */ }
      }
    }

    // Fallback: scan attach directory for image files by timestamp
    // Get the message timestamp from search results to narrow down the date
    const searchResult = runCli(['search', '', '--limit', '500', '--msg-type', 'image', '--format', 'json'], 30000);
    let datePrefix = '';
    if (searchResult.exitCode === 0) {
      try {
        const parsed = JSON.parse(searchResult.stdout);
        const messages: string[] = parsed.results || [];
        const targetMsg = messages.find((m: string) => m.includes(`local_id=${localId})`));
        if (targetMsg) {
          const dateMatch = targetMsg.match(/\[(\d{4}-\d{2})-/);
          if (dateMatch) datePrefix = dateMatch[1];
        }
      } catch { /* ignore */ }
    }

    // Scan the WeChat attach directory for image files
    const configPath = path.join(process.env.HOME || '/Users/chenshibin', '.wechat-reader', 'config.json');
    let attachDir = '';
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const wechatBase = path.dirname(config.db_dir);
      attachDir = path.join(wechatBase, 'msg', 'attach');
    } catch { /* ignore */ }

    if (!attachDir || !fs.existsSync(attachDir)) {
      res.status(404).json({ ok: false, error: 'WeChat attach directory not found' });
      return;
    }

    // Scan subdirectories for matching date + Img folder
    try {
      const subdirs = fs.readdirSync(attachDir);
      for (const subdir of subdirs) {
        const dateDir = datePrefix
          ? path.join(attachDir, subdir, datePrefix, 'Img')
          : null;

        const dirsToSearch: string[] = [];
        if (dateDir && fs.existsSync(dateDir)) {
          dirsToSearch.push(dateDir);
        }

        for (const imgDir of dirsToSearch) {
          const files = fs.readdirSync(imgDir).filter(f => f.endsWith('.dat'));
          // Find the _h.dat (PNG high quality) for the first image we can decode
          const hdFiles = files.filter(f => f.endsWith('_h.dat'));
          const thumbFiles = files.filter(f => f.endsWith('_t.dat'));
          const origFiles = files.filter(f => !f.endsWith('_h.dat') && !f.endsWith('_t.dat') && !f.endsWith('_M.dat'));

          // We can't match by md5 without the raw XML content
          // But we can try to serve any available image for now
          // A better approach would be to extract md5 from the message content
          // For now, return a 404 since we can't determine which file matches
          break;
        }
      }
    } catch { /* ignore */ }

    res.status(404).json({ ok: false, error: `Image not found for local_id=${localId} (CLI media resolution failed and md5 matching unavailable)` });
  });

  // -----------------------------------------------------------------------
  // API: serve local image/file for preview
  // -----------------------------------------------------------------------
  app.get("/api/file", (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ ok: false, error: 'path parameter required' });
      return;
    }
    // Security: only allow files under common WeChat data directories
    const normalized = path.normalize(filePath);
    const allowedPrefixes = ['/Users/', '/home/', 'C:\\', 'D:\\'];
    const isAllowed = allowedPrefixes.some(p => normalized.startsWith(p)) && !normalized.includes('..');
    if (!isAllowed) {
      res.status(403).json({ ok: false, error: 'Access denied' });
      return;
    }
    if (!fs.existsSync(normalized)) {
      res.status(404).json({ ok: false, error: 'File not found' });
      return;
    }
    // Determine content type from extension
    const ext = path.extname(normalized).toLowerCase();

    // WeChat .dat files need decoding
    if (ext === '.dat') {
      try {
        const buf = fs.readFileSync(normalized);
        const decoded = decodeWechatDat(buf);
        if (decoded) {
          // wxgf (HEVC) format cannot be displayed in browser
          // Try to find _h.dat (PNG) or _t.dat (JPEG) as fallback
          if (decoded.mime === 'image/wxgf') {
            const baseWithoutExt = normalized.replace(/\.dat$/, '');
            const hDat = baseWithoutExt + '_h.dat';
            const tDat = baseWithoutExt + '_t.dat';
            let fallbackPath: string | null = null;
            // Prefer _h.dat (high quality PNG), then _t.dat (thumbnail JPEG)
            if (fs.existsSync(hDat)) {
              fallbackPath = hDat;
            } else if (fs.existsSync(tDat)) {
              fallbackPath = tDat;
            }
            if (fallbackPath) {
              const fallbackBuf = fs.readFileSync(fallbackPath);
              const fallbackDecoded = decodeWechatDat(fallbackBuf);
              if (fallbackDecoded) {
                res.setHeader('Content-Type', fallbackDecoded.mime);
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.send(fallbackDecoded.data);
                return;
              }
            }
            // No fallback available — send wxgf as application/octet-stream with a hint
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.send(decoded.data);
            return;
          }

          res.setHeader('Content-Type', decoded.mime);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.send(decoded.data);
          return;
        }
        // If decoding fails, try sending the raw file with a generic image type
        // Some .dat files are actually just renamed standard image files
        // Try to detect by checking for common image signatures in the raw data
        const rawMime = detectImageMimeFromRaw(buf);
        if (rawMime) {
          console.log(`[api/file] .dat file appears to be raw ${rawMime}, serving directly: ${normalized}`);
          res.setHeader('Content-Type', rawMime);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.send(buf);
          return;
        }
        res.status(422).json({ ok: false, error: 'Unable to decode .dat file (unsupported encryption format)' });
        return;
      } catch {
        res.status(500).json({ ok: false, error: 'Read error' });
        return;
      }
    }

    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
      '.svg': 'image/svg+xml', '.tiff': 'image/tiff', '.tif': 'image/tiff',
      '.mp4': 'video/mp4', '.mov': 'video/quicktime',
      '.pdf': 'application/pdf', '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const stream = fs.createReadStream(normalized);
    stream.on('error', () => res.status(500).json({ ok: false, error: 'Read error' }));
    stream.pipe(res);
  });

  // -----------------------------------------------------------------------
  // Contacts cache (in-memory)
  // -----------------------------------------------------------------------
  let contactsCache: { data: any; timestamp: number } | null = null;
  const CONTACTS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

  // -----------------------------------------------------------------------
  // API: fetch contacts from CLI (merge contacts + sessions)
  // -----------------------------------------------------------------------
  app.get("/api/contacts", (req, res) => {
    const query = (req.query.query as string) || '';
    const limit = (req.query.limit as string) || '5000';

    // Check contacts cache (only for full queries without search filter)
    if (!query && contactsCache && Date.now() - contactsCache.timestamp < CONTACTS_CACHE_TTL) {
      console.log('[API /api/contacts] cache hit');
      res.json(contactsCache.data);
      return;
    }

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

      const responseData = { ok: true, data: classified };

      // Cache the full contacts list (no query filter)
      if (!query) {
        contactsCache = { data: responseData, timestamp: Date.now() };
      }

      res.json(responseData);
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
  // Messages response cache (in-memory, keyed by CLI args)
  // -----------------------------------------------------------------------
  const messagesCache = new Map<string, { data: any; timestamp: number }>();
  const MESSAGES_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
  const MESSAGES_CACHE_MAX = 30;

  function getMessagesCacheKey(chatNames: string[], limit: string, offset: string, keyword: string, msgType: string, startTime: string, endTime: string): string {
    return `${chatNames.sort().join(',')}|${limit}|${offset}|${keyword}|${msgType}|${startTime}|${endTime}`;
  }

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

      // Check messages cache
      const cacheKey = getMessagesCacheKey(chatNames, limit, offset, keyword, msgType, startTime, endTime);
      const cached = messagesCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < MESSAGES_CACHE_TTL) {
        console.log(`[API /api/messages] cache hit for ${cacheKey}`);
        res.json(cached.data);
        return;
      }

      // Evict oldest entries if cache is full
      if (messagesCache.size >= MESSAGES_CACHE_MAX) {
        let oldestKey = '';
        let oldestTime = Infinity;
        for (const [k, v] of messagesCache) {
          if (v.timestamp < oldestTime) {
            oldestTime = v.timestamp;
            oldestKey = k;
          }
        }
        if (oldestKey) messagesCache.delete(oldestKey);
      }

      // Use empty keyword so CLI uses limit+offset as batch size (no 500 cap)
      // For single-chat queries without keyword, use `history` command which is more direct
      const useHistory = chatNames.length === 1 && !keyword;
      const args: string[] = [];
      if (useHistory) {
        args.push('history', chatNames[0], '--limit', limit, '--offset', offset, '--format', 'json');
      } else {
        args.push('search', keyword, '--limit', limit, '--offset', offset, '--format', 'json');
        for (const cn of chatNames) {
          args.push('--chat', cn);
        }
      }
      if (startTime) args.push('--start-time', startTime);
      if (endTime) args.push('--end-time', endTime);
      if (!useHistory && msgType) args.push('--msg-type', msgType);

      console.log('[API /api/messages] running CLI:', args.join(' '));

      // Adjust timeout: use shorter timeout for small limits
      const numLimit = parseInt(limit, 10) || 5000;
      const timeoutMs = numLimit <= 200 ? 30000 : 120000; // 30s for quick fetch, 2min for full
      const result = runCli(args, timeoutMs);

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

      // Transform CLI results into WeChatMessage format
      const messages: {
        id: string;
        type: string;
        contactId: string;
        senderName: string;
        contentType: string;
        content: string;
        timestamp: number;
        metadata?: { url?: string };
      }[] = [];

      if (Array.isArray(parsed.results) || Array.isArray(parsed.messages)) {
        // `search` command outputs `results`, `history` command outputs `messages`
        // Both are arrays of formatted message strings
        const lines: string[] = parsed.results || parsed.messages;
        // For `history` command, get chat display name from parsed output
        const historyChatName = parsed.chat || '';
        for (const line of lines) {
          if (typeof line !== 'string') continue;
          // Parse format from search command:
          //   "[2025-01-15 14:30] [ChatName] message content"
          // Parse format from history command:
          //   "[2025-01-15 14:30] message content"  (no [ChatName] bracket)
          const searchMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \[([^\]]+)\]\s*([\s\S]+)$/);
          const historyMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s*([\s\S]+)$/);
          
          let timeStr = '';
          let chatName = '';
          let rest = '';

          if (searchMatch) {
            timeStr = searchMatch[1];
            chatName = searchMatch[2];
            rest = searchMatch[3];
          } else if (historyMatch) {
            timeStr = historyMatch[1];
            chatName = historyChatName || chatNames[0] || '';
            rest = historyMatch[2];
          } else {
            continue;
          }

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

          const isGroup = chatName.includes('群') || chatName.includes('group') || chatNames.some(cn => cn.includes('@chatroom'));

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
          // Trim leading whitespace — CLI may output " [图片] /path" with leading space
          const trimmedContent = content.trimStart();
          let contentType = 'text';
          let metadata: { url?: string; filePath?: string; title?: string; digest?: string } = {};

          if (trimmedContent.startsWith('[图片]')) {
            contentType = 'image';
            // Extract file path from content like [图片] /path/to/file  or [图片] /path (文件不存在)
            // The path starts with / or ../ or drive letter
            const pathMatch = trimmedContent.match(/\[图片\]\s+((?:\/|\.\.\/|\w:\\)[^\s]+?)(?:\s*\(文件不存在\))?$/);
            if (pathMatch) metadata.filePath = pathMatch[1];
            // Extract local_id from content like [图片] (local_id=123)
            if (!metadata.filePath) {
              const lidMatch = trimmedContent.match(/local_id=(\d+)/);
              if (lidMatch) metadata.filePath = `img:${lidMatch[1]}`;
            }
          } else if (trimmedContent.startsWith('[语音]')) {
            contentType = 'voice';
          } else if (trimmedContent.startsWith('[视频]')) {
            contentType = 'video';
          } else if (trimmedContent.startsWith('[文件]')) {
            contentType = 'file';
            // Extract file path from content like [文件] filename\n  /path/to/file
            const fileMatch = trimmedContent.match(/\[文件\]\s*(.+?)(?:\n\s+(.+))?$/);
            if (fileMatch) {
              metadata.title = fileMatch[1].trim();
              if (fileMatch[2]) metadata.filePath = fileMatch[2].trim();
            }
          } else if (trimmedContent.startsWith('[链接/文件]')) {
            contentType = 'link';
            // Try to extract URL from content (URL may contain &amp; entities)
            const urlMatch = trimmedContent.match(/https?:\/\/[^\s<>"']+/);
            if (urlMatch) metadata.url = decodeXmlEntities(urlMatch[0]);
            // Extract title: [链接/文件] title URL → get title before URL
            const titleAndUrlMatch = trimmedContent.match(/\[链接\/文件\]\s*(.+?)(?:\s+https?:\/\/|$)/);
            if (titleAndUrlMatch && titleAndUrlMatch[1].trim()) metadata.title = titleAndUrlMatch[1].trim();
          } else if (trimmedContent.startsWith('[链接]')) {
            contentType = 'link';
            const urlMatch = trimmedContent.match(/https?:\/\/[^\s<>"']+/);
            if (urlMatch) metadata.url = decodeXmlEntities(urlMatch[0]);
            // Extract title: [链接] title URL → get title before URL
            const titleAndUrlMatch = trimmedContent.match(/\[链接\]\s*(.+?)(?:\s+https?:\/\/|$)/);
            if (titleAndUrlMatch && titleAndUrlMatch[1].trim()) metadata.title = titleAndUrlMatch[1].trim();
          } else if (trimmedContent.startsWith('[小程序]')) {
            contentType = 'link';
            // 小程序 may have weapp:// or https:// URL
            const urlMatch = trimmedContent.match(/(?:https?:\/\/|weapp:\/\/)[^\s<>"']+/);
            if (urlMatch) metadata.url = decodeXmlEntities(urlMatch[0]);
            const titleAndUrlMatch = trimmedContent.match(/\[小程序\]\s*(.+?)(?:\s+(?:https?:\/\/|weapp:\/\/)|$)/);
            if (titleAndUrlMatch && titleAndUrlMatch[1].trim()) metadata.title = titleAndUrlMatch[1].trim();
          }

          // For official accounts, check if content has article-like patterns
          // Check: chat param starts with gh_, chatName contains 公众号, sender starts with gh_,
          // or content type is already article
          const isOfficialAccount = chatNames.some(cn => cn.startsWith('gh_')) || chatName.includes('公众号') || sender.startsWith('gh_') || contentType === 'article';
          if (isOfficialAccount || contentType === 'link') {
            // Try extracting URL if not already found
            if (!metadata.url) {
              const urlMatch = content.match(/https?:\/\/[^\s<>"']+/);
              if (urlMatch) metadata.url = decodeXmlEntities(urlMatch[0]);
            }
            // Extract title from XML <title> tag if present
            if (!metadata.title && content.includes('<title>')) {
              const xmlTitleMatch = content.match(/<title>([\s\S]*?)<\/title>/);
              if (xmlTitleMatch) {
                let title = xmlTitleMatch[1].trim();
                // Clean CDATA wrappers
                title = title.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
                if (title) metadata.title = title;
              }
            }
            // Extract digest from <des> tag if present
            if (!metadata.digest && content.includes('<des>')) {
              const desMatch = content.match(/<des>([\s\S]*?)<\/des>/);
              if (desMatch) {
                let digest = desMatch[1].trim();
                // Clean CDATA wrappers
                digest = digest.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
                if (digest) metadata.digest = digest;
              }
            }
            // For links with URL, classify as article if it looks like a WeChat article
            if (metadata.url && (metadata.url.includes('mp.weixin.qq.com') || metadata.url.includes('wechat.com'))) {
              if (contentType === 'link') contentType = 'article';
            }
          }

          // Determine isRead (always true since we no longer track read status)
          const isRead = true;

          const msgObj: {
            id: string;
            type: string;
            contactId: string;
            senderName: string;
            contentType: string;
            content: string;
            timestamp: number;
            metadata?: { url?: string; filePath?: string; title?: string; digest?: string };
          } = {
            id: `msg-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
            type: isGroup ? 'group' : isOfficialAccount ? 'official_account' : 'person',
            contactId: chatName,
            senderName: sender || chatName,
            contentType: contentType,
            content: content,
            timestamp: timestamp,
          };

          if (Object.keys(metadata).length > 0) {
            msgObj.metadata = metadata;
          }

          messages.push(msgObj);
        }
      }

      console.log(`[API /api/messages] returned ${messages.length} messages`);

      const responseData = {
        ok: true,
        data: {
          scope: parsed.scope || '',
          count: messages.length,
          offset: Number(offset),
          limit: Number(limit),
          messages: messages,
        },
      };

      // Cache the response
      messagesCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

      res.json(responseData);
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
      server: { middlewareMode: true, hmr: { port: 3001 } },
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

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
