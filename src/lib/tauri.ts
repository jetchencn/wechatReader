/**
 * 重新导出 mock-tauri 统一 invoke 层。
 *
 * 所有文件操作和 Tauri 命令都应通过此模块调用，
 * 以确保桌面端和网页端使用同一套代码。
 */

export {
  isTauri,
  unifiedInvoke,
  getAppInfo,
  getDataDir,
  readFile,
  writeFile,
  listDirectory,
  fileExists,
  createDirectory,
  deleteFile,
  openFileDialog,
  openDirectoryDialog,
  saveFileDialog,
  openUrl,
  getEnvVar,
  runCli,
  checkInitStatus,
} from '../mock-tauri/index';

export type {
  AppInfo,
  FileEntry,
  FileFilter,
  InitStatus,
} from '../mock-tauri/index';

// 兼容旧代码的别名
export { isTauri as isRunningInTauri } from '../mock-tauri/index';