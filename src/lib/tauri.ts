import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

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
  return invoke<AppInfo>('get_app_info');
}

export async function getDataDir(): Promise<string> {
  return invoke<string>('get_data_dir');
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>('read_file', { path });
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return invoke<void>('write_file', { path, contents });
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('list_directory', { path });
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>('file_exists', { path });
}

export async function createDirectory(path: string): Promise<void> {
  return invoke<void>('create_directory', { path });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke<void>('delete_file', { path });
}

export async function openFileDialog(
  title?: string,
  filters?: FileFilter[]
): Promise<string | null> {
  const result = await open({
    title,
    filters,
    multiple: false,
  });
  return result as string | null;
}

export async function openDirectoryDialog(
  title?: string
): Promise<string | null> {
  const result = await open({
    title,
    directory: true,
    multiple: false,
  });
  return result as string | null;
}

export async function saveFileDialog(
  title?: string,
  defaultPath?: string,
  filters?: FileFilter[]
): Promise<string | null> {
  const result = await save({
    title,
    defaultPath,
    filters,
  });
  return result as string | null;
}

export async function openUrl(url: string): Promise<void> {
  return invoke<void>('open_url', { url });
}

export async function getEnvVar(name: string): Promise<string | null> {
  return invoke<string | null>('get_env_var', { name });
}

export function isRunningInTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}
