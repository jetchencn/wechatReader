import { readFile, writeFile, fileExists, createDirectory, getDataDir } from './tauri';

const CONFIG_FILE = 'config.json';
const DATA_FILE = 'data.json';

export interface AppConfig {
  wechatDbPath: string | null;
  subscribedContacts: string[];
  theme: 'light' | 'dark' | 'system';
}

export interface AppData {
  contacts: any[];
  messages: any[];
  articles: any[];
  views: any[];
}

const defaultConfig: AppConfig = {
  wechatDbPath: null,
  subscribedContacts: [],
  theme: 'system',
};

const defaultData: AppData = {
  contacts: [],
  messages: [],
  articles: [],
  views: [],
};

let dataDir: string | null = null;

async function getDataDirectory(): Promise<string> {
  if (!dataDir) {
    dataDir = await getDataDir();
    try {
      await createDirectory(dataDir);
    } catch (e) {
      console.warn('Failed to create data directory:', e);
    }
  }
  return dataDir;
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const dir = await getDataDirectory();
    const configPath = `${dir}/${CONFIG_FILE}`;
    
    if (await fileExists(configPath)) {
      const content = await readFile(configPath);
      return { ...defaultConfig, ...JSON.parse(content) };
    }
  } catch (e) {
    console.warn('Failed to load config:', e);
  }
  return defaultConfig;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  try {
    const dir = await getDataDirectory();
    await writeFile(`${dir}/${CONFIG_FILE}`, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
    throw e;
  }
}

export async function loadData(): Promise<AppData> {
  try {
    const dir = await getDataDirectory();
    const dataPath = `${dir}/${DATA_FILE}`;
    
    if (await fileExists(dataPath)) {
      const content = await readFile(dataPath);
      return { ...defaultData, ...JSON.parse(content) };
    }
  } catch (e) {
    console.warn('Failed to load data:', e);
  }
  return defaultData;
}

export async function saveData(data: AppData): Promise<void> {
  try {
    const dir = await getDataDirectory();
    await writeFile(`${dir}/${DATA_FILE}`, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save data:', e);
    throw e;
  }
}

export async function loadContacts(): Promise<any[]> {
  const data = await loadData();
  return data.contacts;
}

export async function saveContacts(contacts: any[]): Promise<void> {
  const data = await loadData();
  data.contacts = contacts;
  await saveData(data);
}

export async function loadMessages(): Promise<any[]> {
  const data = await loadData();
  return data.messages;
}

export async function saveMessages(messages: any[]): Promise<void> {
  const data = await loadData();
  data.messages = messages;
  await saveData(data);
}

export async function loadArticles(): Promise<any[]> {
  const data = await loadData();
  return data.articles;
}

export async function saveArticles(articles: any[]): Promise<void> {
  const data = await loadData();
  data.articles = articles;
  await saveData(data);
}
