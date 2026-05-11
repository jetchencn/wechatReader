import { create } from 'zustand';
import { Contact, WeChatMessage, Article, SavedView } from '../types';
import { mockContacts, mockMessages, mockArticles, mockViews } from '../lib/mockData';

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
  setSubscribedContacts: (contactIds: string[]) => void;
  
  selectContact: (id: string | null) => void;
  selectView: (id: number | null) => void;
  setSearchQuery: (query: string) => void;
  
  downloadArticle: (id: string) => void;
  resetState: () => void;
}

export const useAppStore = create<AppState>((set) => ({
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
  
  setSubscribedContacts: (contactIds) => set((state) => ({
    contacts: state.contacts.map((c) => ({
      ...c,
      isSubscribed: contactIds.includes(c.id)
    })),
    selectedContactId: state.selectedContactId && !contactIds.includes(state.selectedContactId) ? null : state.selectedContactId
  })),
  
  selectContact: (id) => set({ selectedContactId: id, selectedViewId: null, searchQuery: '' }),
  selectView: (id) => set({ selectedViewId: id, selectedContactId: null, searchQuery: '' }),
  setSearchQuery: (query) => set({ searchQuery: query, selectedContactId: null, selectedViewId: null }),
  
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
  })
}));
