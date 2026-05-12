import { create } from 'zustand';
import { Contact, WeChatMessage, Article, SavedView, ContactType } from '../types';

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
  selectedContactType: ContactType | null;
  searchQuery: string;
  showWizard: boolean;
  settingsTab: string;
  
  setInitialized: (val: boolean) => void;
  setShowWizard: (val: boolean) => void;
  setSettingsTab: (tab: string) => void;
  setWechatProcessDetected: (val: boolean) => void;
  setDbPathDetected: (val: string | null) => void;
  
  setContacts: (contacts: Contact[]) => void;
  subscribeContacts: (contactIds: string[]) => void;
  unsubscribeContact: (contactId: string) => void;
  setSubscribedContacts: (contactIds: string[]) => void;
  
  selectContact: (id: string | null) => void;
  selectView: (id: number | null) => void;
  selectContactType: (type: ContactType | null) => void;
  setSearchQuery: (query: string) => void;
  setViews: (views: SavedView[]) => void;
  setMessages: (messages: WeChatMessage[]) => void;
  
  downloadArticle: (id: string) => void;
  resetState: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  isInitialized: true,
  wechatProcessDetected: false,
  dbPathDetected: null,
  
  contacts: [],
  messages: [],
  articles: [],
  views: [],
  
  selectedContactId: null,
  selectedViewId: null,
  selectedContactType: null,
  searchQuery: '',
  showWizard: false,
  settingsTab: '',
  
  setInitialized: (val) => set({ isInitialized: val }),
  setShowWizard: (val) => set({ showWizard: val }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setWechatProcessDetected: (val) => set({ wechatProcessDetected: val }),
  setDbPathDetected: (val) => set({ dbPathDetected: val }),
  
  setContacts: (contacts) => set({ contacts }),
  
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
  
  setSubscribedContacts: (contactIds) => set((state) => ({
    contacts: state.contacts.map((c) => ({
      ...c,
      isSubscribed: contactIds.includes(c.id)
    })),
    selectedContactId: state.selectedContactId && !contactIds.includes(state.selectedContactId) ? null : state.selectedContactId
  })),
  
  selectContact: (id) => set({ selectedContactId: id, selectedViewId: null, selectedContactType: null, searchQuery: '' }),
  selectView: (id) => set({ selectedViewId: id, selectedContactId: null, selectedContactType: null, searchQuery: '' }),
  selectContactType: (type) => set({ selectedContactType: type, selectedContactId: null, selectedViewId: null, searchQuery: '' }),
  setSearchQuery: (query) => set({ searchQuery: query, selectedContactId: null, selectedViewId: null, selectedContactType: null }),
  setViews: (views) => set({ views }),
  setMessages: (messages) => set({ messages }),
  
  downloadArticle: (id) => set((state) => ({
    articles: state.articles.map((a) =>
      a.id === id ? { ...a, isDownloaded: true } : a
    )
  })),
  
  resetState: () => set({
    isInitialized: true,
    selectedContactId: null,
    selectedViewId: null,
    selectedContactType: null,
    searchQuery: '',
    showWizard: true,
    contacts: [],
  })
}));
