import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../store';
import { Search, Clock, CalendarDays, BookMarked, Paperclip, Loader2 } from 'lucide-react';
import { MessageTable } from './MessageTable';
import { WeChatMessage } from '../types';
import { getMaxQueryLimit } from './SettingsView';

export function GlobalSearch({ overrideViewId }: { overrideViewId?: number }) {
  const { searchQuery, messages, views, contacts } = useAppStore();
  const subscribedContactIds = useMemo(() => 
    contacts.filter(c => c.isSubscribed).map(c => c.id),
    [contacts]
  );

  const view = overrideViewId ? views.find(v => v.id === overrideViewId) : null;

  // State for server-fetched messages
  const [serverMessages, setServerMessages] = useState<WeChatMessage[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Build time params based on view
  const getTimeParams = useCallback(() => {
    const params = new URLSearchParams();
    if (!view?.filters) return params;

    if (view.filters.timeRange === 'today') {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      params.set('start-time', `${y}-${m}-${d} 00:00:00`);
    } else if (view.filters.timeRange === '7days') {
      const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      params.set('start-time', `${y}-${m}-${day} 00:00:00`);
    }
    return params;
  }, [view?.filters]);

  // Fetch real messages from server when a view is selected
  // Fetch per chat individually to ensure complete data for each subscription
  // For "公众号文章" view (id === 3), fetch from /api/articles (local favorites)
  useEffect(() => {
    if (!view || !view.filters) {
      setServerMessages(null);
      return;
    }

    let cancelled = false;

    async function fetchMessages() {
      setIsLoading(true);
      setFetchError(null);

      try {
        // View 3: "公众号文章" - fetch from local favorites
        if (view!.id === 3) {
          // Read local article dir from localStorage
          let localDir = '';
          try {
            localDir = localStorage.getItem('wechat-reader:config:localArticleDir') || '';
          } catch { /* ignore */ }

          const maxLimit = getMaxQueryLimit();
          const params = new URLSearchParams({ limit: String(maxLimit) });
          if (localDir) params.set('local_dir', localDir);

          const res = await fetch(`/api/articles?${params.toString()}`);
          const json = await res.json();

          if (cancelled) return;

          if (json.ok && Array.isArray(json.data?.articles)) {
            const articlesAsMessages: WeChatMessage[] = json.data.articles.map((a: any) => ({
              id: a.id,
              type: 'official_account' as const,
              contactId: a.sourceChat || '收藏',
              senderName: a.author || '',
              contentType: 'article' as const,
              content: a.digest ? `${a.title} - ${a.digest}` : a.title,
              timestamp: a.publishTime || 0,
              isRead: true,
              metadata: { url: a.url || '' },
            }));
            setServerMessages(articlesAsMessages);
          } else {
            setFetchError(json.error || 'Failed to fetch articles');
            setServerMessages(null);
          }
          return;
        }

        // Other views: fetch messages per chat
        const subscribedContacts = contacts.filter(c => c.isSubscribed);
        const allMessages: WeChatMessage[] = [];
        const maxLimit = getMaxQueryLimit();
        const CONCURRENCY = 5; // limit concurrent CLI processes to avoid timeout

        // Use contact.id (wxid) instead of contact.name to avoid CLI display name resolution issues
        async function fetchWithConcurrency<T>(
          items: T[],
          fn: (item: T) => Promise<WeChatMessage[]>,
          concurrency: number
        ): Promise<WeChatMessage[]> {
          const results: WeChatMessage[] = [];
          const queue = [...items];
          async function worker() {
            while (queue.length > 0) {
              const item = queue.shift()!;
              const msgs = await fn(item);
              results.push(...msgs);
            }
          }
          const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
          await Promise.all(workers);
          return results;
        }

        const fetchedMessages = await fetchWithConcurrency(
          subscribedContacts,
          async (contact) => {
            try {
              const params = getTimeParams();
              params.set('limit', String(maxLimit));
              params.set('offset', '0');
              params.set('chat', contact.id);

              const res = await fetch(`/api/messages?${params.toString()}`);
              const json = await res.json();

              if (json.ok && Array.isArray(json.data?.messages)) {
                return json.data.messages as WeChatMessage[];
              }
            } catch (e) {
              console.warn(`[GlobalSearch] Failed to fetch messages for "${contact.name}":`, e);
            }
            return [];
          },
          CONCURRENCY
        );

        if (cancelled) return;
        allMessages.push(...fetchedMessages);

        setServerMessages(allMessages);
      } catch (err) {
        if (!cancelled) {
          setFetchError(String(err));
          setServerMessages(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchMessages();
    return () => { cancelled = true; };
  }, [view?.id, view?.filters?.timeRange, getTimeParams, contacts]);

  // Use server messages if available, otherwise fall back to store messages
  const effectiveMessages = serverMessages ?? messages;

  const filteredMessages = useMemo(() => {
    // Server already filters by subscribed chat names via --chat param,
    // but keep a safety net for mock data fallback
    const subscribedNames = new Set(
      contacts.filter(c => c.isSubscribed).map(c => c.name)
    );

    let baseFiltered = effectiveMessages.filter(m => {
      // For server messages, contactId is the chat display name
      // For mock data, contactId is the WeChat username
      return subscribedNames.has(m.contactId) || contacts.some(c => c.isSubscribed && c.id === m.contactId);
    });
    
    // Apply view filters if present
    if (view && view.filters) {
      const { types, contentTypes } = view.filters;
      
      if (types && types.length > 0) {
        baseFiltered = baseFiltered.filter(m => types.includes(m.type as any));
      }
      
      if (contentTypes && contentTypes.length > 0) {
        baseFiltered = baseFiltered.filter(m => contentTypes.includes(m.contentType as any));
      }
    }
    
    // Note: Search query is handled INSIDE MessageTable for local search,
    // but if we are in Search mode (no overrideViewId), we use the global searchQuery.
    if (!overrideViewId && searchQuery) {
      const q = searchQuery.toLowerCase();
      baseFiltered = baseFiltered.filter(m => 
        (m.content && m.content.toLowerCase().includes(q)) || 
        (m.senderName && m.senderName.toLowerCase().includes(q))
      );
    }
    
    return baseFiltered;
  }, [effectiveMessages, view, overrideViewId, searchQuery, contacts]);

  const title = view ? view.name : (
    <div className="flex items-center">
      搜索结果
      <span className="ml-3 font-normal text-[#71717A] italic text-sm">"{searchQuery}"</span>
    </div>
  );

  const icon = view ? (
    <span className="flex items-center justify-center">
      {view.id === 1 && <Clock className="w-5 h-5" />}
      {view.id === 2 && <CalendarDays className="w-5 h-5" />}
      {view.id === 3 && <BookMarked className="w-5 h-5" />}
      {view.id === 4 && <Paperclip className="w-5 h-5" />}
      {![1, 2, 3, 4].includes(view.id) && view.icon}
    </span>
  ) : (
    <div className="w-6 h-6 rounded bg-black flex items-center justify-center">
      <Search className="w-3 h-3 text-white" />
    </div>
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-0 bg-white">
        <Loader2 className="w-10 h-10 text-[#A1A1AA] animate-spin mb-4" />
        <p className="text-sm text-[#71717A]">正在从微信数据库加载消息...</p>
      </div>
    );
  }

  // Error state
  if (fetchError && !serverMessages) {
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-white">
        <div className="flex flex-col items-center justify-center shrink-0 py-8">
          <p className="text-sm text-red-500 mb-2">加载失败: {fetchError}</p>
          <p className="text-xs text-[#A1A1AA]">将显示本地缓存数据</p>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <MessageTable 
            key={`global-search-${view?.id || 'search'}-${subscribedContactIds.join(',')}`}
            messages={filteredMessages}
            title={title}
            icon={icon}
            searchPlaceholder={view ? `在"${view.name}"中搜索...` : "搜索结果..."}
          />
        </div>
      </div>
    );
  }

  // Pass full filteredMessages to MessageTable so search/filters work on complete dataset.
  // Pagination is handled inside MessageTable via enablePagination prop.
  // showDate for views that span multiple days (e.g. "近7天消息")
  return (
    <MessageTable 
      key={`global-search-${view?.id || 'search'}-${subscribedContactIds.join(',')}`}
      messages={filteredMessages}
      title={title}
      icon={icon}
      searchPlaceholder={view ? `在"${view.name}"中搜索...` : "搜索结果..."}
      enablePagination={true}
      showDate={view?.id === 2 || view?.id === 3}
    />
  );
}
