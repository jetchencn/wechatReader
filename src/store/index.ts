import { create } from 'zustand';
import { Contact, WeChatMessage, Article, SavedView } from '../types';
import { mockContacts, mockMessages, mockArticles, mockViews } from '../lib/mockData';
import { isRunningInTauri, getDataDir, createDirectory, fileExists, readFile, writeFile } from '../lib/tauri';

const CONFIG_FILE = 'config.json';
const DATA_FILE = 'data.json';

interface AppConfig {
  wechatDbPath: string | null;
  subscribedContacts: string[];
}

interface AppData {
  contacts: Contact[];
  messages: WeChatMessage[];
  articles: Article[];
}

interface AppState {
  isInitialized: boolean;
  wechatProcessDetected: boolean;
  dbPathDetected: string | null;

  contacts: Contact[];
  messages: WeChatMessage[];
  articles: Article[];
  views: SavedView[];

  selectedContactId: string | null;
  selectedViewId: number | null;
  searchQuery: string;
  showWizard: boolean;

  setInitialized: (val: boolean) => void;
  setShowWizard: (val: boolean) => void;
  setWechatProcessDetected: (val: boolean) => void;
  setDbPathDetected: (val: string | null) => void;

  subscribeContacts: (contactIds: string[]) => void;
  unsubscribeContact: (contactId: string) => void;

  selectContact: (id: string | null) => void;
  selectView: (id: number | null) => void;
  setSearchQuery: (query: string) => void;

  downloadArticle: (id: string) => void;
  resetState: () => void;

  loadPersistedData: () => Promise<void>;
  persistData: () => Promise<void>;
}

let dataDir: string | null = null;

async function getDataDirectory(): Promise<string> {
  if (!dataDir && isRunningInTauri()) {
    try {
      dataDir = await getDataDir();
      await createDirectory(dataDir);
    } catch (e) {
      console.warn('Failed to get/create data directory:', e);
    }
  }
  return dataDir || '';
}

export const useAppStore = create<AppState>((set, get) => ({
  isInitialized: false,
  wechatProcessDetected: false,
  dbPathDetected: null,

  contacts: mockContacts,
  messages: mockMessages,
  articles: mockArticles,
  views: mockViews,

  selectedContactId: null,
  selectedViewId: null,
  searchQuery: '',
  showWizard: false,

  setInitialized: (val) => set({ isInitialized: val }),
  setShowWizard: (val) => set({ showWizard: val }),
  setWechatProcessDetected: (val) => set({ wechatProcessDetected: val }),
  setDbPathDetected: (val) => set({ dbPathDetected: val }),

  subscribeContacts: (contactIds) => set((state) => ({
    contacts: state.contacts.map((c) =>
      contactIds.includes(c.id) ? { ...c, isSubscribed: true } : c
    )
  })),

  unsubscribeContact: (contactId) => set((state) => ({
    contacts: state.contacts.map((c) =>
      c.id === contactId ? { ...c, isSubscribed: false } : c
    ),
    selectedContactId: state.selectedContactId === contactId ? null : state.selectedContactId
  })),

  selectContact: (id) => set({ selectedContactId: id, selectedViewId: null, searchQuery: '', showWizard: false }),
  selectView: (id) => set({ selectedViewId: id, selectedContactId: null, searchQuery: '', showWizard: false }),
  setSearchQuery: (query) => set({ searchQuery: query, selectedContactId: null, selectedViewId: null, showWizard: false }),

  downloadArticle: (id) => set((state) => ({
    articles: state.articles.map((a) =>
      a.id === id ? { ...a, isDownloaded: true } : a
    )
  })),

  resetState: () => set({
    isInitialized: false,
    selectedContactId: null,
    selectedViewId: null,
    searchQuery: '',
    showWizard: true,
    contacts: mockContacts,
  }),

  loadPersistedData: async () => {
    if (!isRunningInTauri()) return;

    try {
      const dir = await getDataDirectory();
      const configPath = `${dir}/${CONFIG_FILE}`;
      const dataPath = `${dir}/${DATA_FILE}`;

      if (await fileExists(configPath)) {
        const configContent = await readFile(configPath);
        const config: AppConfig = JSON.parse(configContent);

        set({
          dbPathDetected: config.wechatDbPath,
          wechatProcessDetected: !!config.wechatDbPath,
        });
      }

      if (await fileExists(dataPath)) {
        const dataContent = await readFile(dataPath);
        const data: AppData = JSON.parse(dataContent);

        if (data.contacts.length > 0 || data.messages.length > 0 || data.articles.length > 0) {
          set({
            contacts: data.contacts,
            messages: data.messages,
            articles: data.articles,
            isInitialized: true,
          });
        }
      }
    } catch (e) {
      console.warn('Failed to load persisted data:', e);
    }
  },

  persistData: async () => {
    if (!isRunningInTauri()) return;

    try {
      const dir = await getDataDirectory();
      const { contacts, messages, articles, dbPathDetected } = get();

      const config = {
        wechatDbPath: dbPathDetected,
        subscribedContacts: contacts.filter(c => c.isSubscribed).map(c => c.id),
      };
      await writeFile(`${dir}/${CONFIG_FILE}`, JSON.stringify(config, null, 2));

      const data = {
        contacts,
        messages,
        articles,
      };
      await writeFile(`${dir}/${DATA_FILE}`, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Failed to persist data:', e);
    }
  },
}));

let persistTimeout: ReturnType<typeof setTimeout> | null = null;

useAppStore.subscribe((state, prevState) => {
  if (
    state.contacts !== prevState.contacts ||
    state.messages !== prevState.messages ||
    state.articles !== prevState.articles
  ) {
    if (persistTimeout) clearTimeout(persistTimeout);
    persistTimeout = setTimeout(() => {
      useAppStore.getState().persistData();
    }, 1000);
  }
});
