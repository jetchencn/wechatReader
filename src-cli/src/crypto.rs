use aes::cipher::{block_padding::NoPadding, BlockDecryptMut, KeyIvInit};
use std::io::{Read, Seek, SeekFrom, Write};

type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

pub const PAGE_SZ: u64 = 4096;
const KEY_SZ: usize = 32;
const SALT_SZ: usize = 16;
const RESERVE_SZ: u64 = 80; // IV(16) + HMAC-SHA512(64)
const SQLITE_HDR: &[u8] = b"SQLite format 3\x00";
const WAL_HEADER_SZ: u64 = 32;
const WAL_FRAME_HEADER_SZ: u64 = 24;

/// 解密一页数据
pub fn decrypt_page(enc_key: &[u8], page_data: &[u8], pgno: u64) -> Vec<u8> {
    let page_sz = PAGE_SZ as usize;
    let reserve_sz = RESERVE_SZ as usize;
    let salt_sz = SALT_SZ;

    // 提取 IV：在页面末尾 RESERVE_SZ 区域的前 16 字节
    let iv = &page_data[page_sz - reserve_sz..page_sz - reserve_sz + 16];
    let encrypted: &[u8];

    if pgno == 1 {
        // 第一页：跳过 salt（前 16 字节）
        encrypted = &page_data[salt_sz..page_sz - reserve_sz];
    } else {
        encrypted = &page_data[..page_sz - reserve_sz];
    }

    // 需要对齐到 AES 块大小
    let aligned_len = (encrypted.len() / 16) * 16;
    let encrypted_aligned = &encrypted[..aligned_len];

    let mut buf = encrypted_aligned.to_vec();
    let decrypted = Aes256CbcDec::new(enc_key.into(), iv.into())
        .decrypt_padded_mut::<NoPadding>(&mut buf)
        .expect("AES-CBC 解密失败");

    if pgno == 1 {
        let mut result = Vec::with_capacity(page_sz);
        result.extend_from_slice(SQLITE_HDR);
        result.extend_from_slice(decrypted);
        result.resize(page_sz, 0);
        result
    } else {
        let mut result = Vec::with_capacity(page_sz);
        result.extend_from_slice(decrypted);
        result.resize(page_sz, 0);
        result
    }
}

/// 全库解密
pub fn full_decrypt(
    db_path: &std::path::Path,
    out_path: &std::path::Path,
    enc_key: &[u8],
) -> Result<u64, String> {
    let file_size = std::fs::metadata(db_path)
        .map_err(|e| format!("无法获取文件大小: {}", e))?
        .len();
    let total_pages = file_size / PAGE_SZ;

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建输出目录失败: {}", e))?;
    }

    let mut fin = std::fs::File::open(db_path)
        .map_err(|e| format!("打开数据库失败: {}", e))?;
    let mut fout = std::fs::File::create(out_path)
        .map_err(|e| format!("创建输出文件失败: {}", e))?;

    for pgno in 1..=total_pages {
        let mut page = vec![0u8; PAGE_SZ as usize];
        let n = fin.read(&mut page).map_err(|e| format!("读取页面失败: {}", e))?;
        if n == 0 {
            break;
        }
        if n < PAGE_SZ as usize {
            page.resize(PAGE_SZ as usize, 0);
        }
        let decrypted = decrypt_page(enc_key, &page, pgno);
        fout.write_all(&decrypted)
            .map_err(|e| format!("写入解密数据失败: {}", e))?;
    }

    Ok(total_pages)
}

/// 解密 WAL 日志
pub fn decrypt_wal(
    wal_path: &std::path::Path,
    db_path: &std::path::Path,  // 已解密的 db 文件
    enc_key: &[u8],
) -> Result<u64, String> {
    if !wal_path.exists() {
        return Ok(0);
    }
    let wal_size = std::fs::metadata(wal_path)
        .map_err(|e| format!("获取 WAL 文件大小失败: {}", e))?
        .len();
    if wal_size <= WAL_HEADER_SZ {
        return Ok(0);
    }

    let mut wf = std::fs::File::open(wal_path)
        .map_err(|e| format!("打开 WAL 文件失败: {}", e))?;
    let mut df = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(db_path)
        .map_err(|e| format!("打开解密数据库失败: {}", e))?;

    let mut wal_hdr = vec![0u8; WAL_HEADER_SZ as usize];
    wf.read_exact(&mut wal_hdr)
        .map_err(|e| format!("读取 WAL header 失败: {}", e))?;

    let wal_salt1 = u32::from_be_bytes([wal_hdr[16], wal_hdr[17], wal_hdr[18], wal_hdr[19]]);
    let wal_salt2 = u32::from_be_bytes([wal_hdr[20], wal_hdr[21], wal_hdr[22], wal_hdr[23]]);

    let frame_size = (WAL_FRAME_HEADER_SZ + PAGE_SZ) as usize;
    let mut patched = 0u64;

    loop {
        let pos = wf.stream_position().map_err(|e| format!("获取位置失败: {}", e))?;
        if pos + frame_size as u64 > wal_size {
            break;
        }

        let mut fh = vec![0u8; WAL_FRAME_HEADER_SZ as usize];
        if wf.read_exact(&mut fh).is_err() {
            break;
        }

        let pgno = u32::from_be_bytes([fh[0], fh[1], fh[2], fh[3]]);
        let frame_salt1 = u32::from_be_bytes([fh[8], fh[9], fh[10], fh[11]]);
        let frame_salt2 = u32::from_be_bytes([fh[12], fh[13], fh[14], fh[15]]);

        let mut ep = vec![0u8; PAGE_SZ as usize];
        if wf.read_exact(&mut ep).is_err() {
            break;
        }

        if pgno == 0 || pgno > 1_000_000 {
            continue;
        }
        if frame_salt1 != wal_salt1 || frame_salt2 != wal_salt2 {
            continue;
        }

        let dec = decrypt_page(enc_key, &ep, pgno as u64);
        df.seek(SeekFrom::Start(((pgno as u64) - 1) * PAGE_SZ))
            .map_err(|e| format!("seek 失败: {}", e))?;
        df.write_all(&dec)
            .map_err(|e| format!("写入解密页面失败: {}", e))?;
        patched += 1;
    }

    Ok(patched)
}
