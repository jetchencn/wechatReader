import React, { useMemo, useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { GlobalSearch } from './GlobalSearch';
import { FolderSync, User, Users, BookOpen, Loader2 } from 'lucide-react';
import { MessageTable } from './MessageTable';
import { WeChatMessage } from '../types';
import { getMaxQueryLimit } from './SettingsView';

export function ContentArea() {
  const { selectedContactId, selectedViewId, selectedContactType, searchQuery, contacts, messages } = useAppStore();

  // Fetch real messages from server for selected contact
  const [serverMessages, setServerMessages] = useState<WeChatMessage[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch messages for contact type view
  const [typeMessages, setTypeMessages] = useState<WeChatMessage[] | null>(null);
  const [isTypeLoading, setIsTypeLoading] = useState(false);
  const [typeFetchError, setTypeFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedContactId) {
      setServerMessages(null);
      setFetchError(null);
      return;
    }

    // Only fetch for subscribed contacts
    const contact = contacts.find(c => c.id === selectedContactId);
    if (!contact || !contact.isSubscribed) {
      setServerMessages(null);
      setFetchError(null);
      return;
    }

    let cancelled = false;

    async function fetchMessages() {
      setIsLoading(true);
      setFetchError(null);
      try {
        const maxLimit = getMaxQueryLimit();
        // Use username (selectedContactId) instead of display name (contact.name)
        // to avoid display name resolution issues in the CLI
        const params = new URLSearchParams({ limit: String(maxLimit), offset: '0', chat: selectedContactId });
        const res = await fetch(`/api/messages?${params.toString()}`);

        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }

        const json = await res.json();

        if (cancelled) return;

        if (json.ok && Array.isArray(json.data?.messages)) {
          setServerMessages(json.data.messages as WeChatMessage[]);
        } else {
          const errMsg = json.error || 'CLI returned no data';
          console.warn(`[ContentArea] No messages for contact "${contact.name}" (id: ${selectedContactId}):`, errMsg);
          setFetchError(errMsg);
          setServerMessages(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(`[ContentArea] Failed to fetch messages for "${contact.name}":`, err);
          setFetchError(String(err));
          setServerMessages(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchMessages();
    return () => { cancelled = true; };
  }, [selectedContactId, contacts]);

  // Fetch messages for contact type view
  useEffect(() => {
    if (!selectedContactType) {
      setTypeMessages(null);
      setTypeFetchError(null);
      return;
    }

    const typedContacts = contacts.filter(c => c.isSubscribed && c.type === selectedContactType);
    if (typedContacts.length === 0) {
      setTypeMessages(null);
      setTypeFetchError(null);
      return;
    }

    let cancelled = false;

    async function fetchTypeMessages() {
      setIsTypeLoading(true);
      setTypeFetchError(null);
      try {
        const maxLimit = getMaxQueryLimit();
        const allMessages: WeChatMessage[] = [];
        const CONCURRENCY = 5;
        let failureCount = 0;

        const queue = [...typedContacts];
        async function worker() {
          while (queue.length > 0) {
            const contact = queue.shift()!;
            try {
              const params = new URLSearchParams({ limit: String(maxLimit), offset: '0', chat: contact.id });
              const res = await fetch(`/api/messages?${params.toString()}`);
              if (!res.ok) throw new Error(`Server returned ${res.status}`);
              const json = await res.json();
              if (json.ok && Array.isArray(json.data?.messages)) {
                allMessages.push(...json.data.messages as WeChatMessage[]);
              }
            } catch (e) {
              failureCount++;
              console.warn(`[ContentArea] Type fetch failed for "${contact.name}":`, e);
            }
          }
        }

        const workers = Array.from({ length: Math.min(CONCURRENCY, typedContacts.length) }, () => worker());
        await Promise.all(workers);

        if (cancelled) return;
        setTypeMessages(allMessages);
        if (failureCount > 0) {
          setTypeFetchError(`${failureCount} 个会话加载失败`);
        }
      } catch (err) {
        if (!cancelled) {
          setTypeFetchError(String(err));
          setTypeMessages(null);
        }
      } finally {
        if (!cancelled) setIsTypeLoading(false);
      }
    }

    fetchTypeMessages();
    return () => { cancelled = true; };
  }, [selectedContactType, contacts]);

  const filteredMessages = useMemo(() => {
    if (!selectedContactId) return [];
    const contact = contacts.find(c => c.id === selectedContactId);
    if (!contact) return [];
    // Use server messages if available, otherwise fall back to store messages
    const source = serverMessages ?? messages;
    // Server messages use display name as contactId, store messages use WeChat username
    return source.filter(m => m.contactId === contact.name || m.contactId === selectedContactId);
  }, [selectedContactId, messages, serverMessages, contacts]);

  // Build content based on current state
  // NOTE: parent <section> already has flex-1 min-h-0 flex flex-col overflow-hidden
  // We wrap everything in a flex-1 min-h-0 flex flex-col container so children can use flex-1

  if (searchQuery) {
    return <div className="flex-1 min-h-0 flex flex-col"><GlobalSearch /></div>;
  }

  if (selectedContactType) {
    const typeLabel = selectedContactType === 'person' ? '联系人' : 
                      selectedContactType === 'group' ? '微信群' : '公众号';
    const typeIcon = selectedContactType === 'person' ? <User className="w-5 h-5" /> : 
                     selectedContactType === 'group' ? <Users className="w-5 h-5" /> : 
                     <BookOpen className="w-5 h-5" />;

    if (isTypeLoading) {
      return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center bg-white">
          <Loader2 className="w-10 h-10 text-[#A1A1AA] animate-spin mb-4" />
          <p className="text-sm text-[#71717A]">正在加载{typeLabel}消息...</p>
        </div>
      );
    }

    if (typeFetchError) {
      return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center bg-white">
          <p className="text-sm text-red-500 mb-2">加载失败: {typeFetchError}</p>
          <p className="text-xs text-[#A1A1AA] mb-4">请检查数据库连接或 CLI 是否正常工作</p>
        </div>
      );
    }

    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <MessageTable 
          key={`type-${selectedContactType}`}
          messages={typeMessages ?? []}
          title={typeLabel}
          icon={typeIcon}
          searchPlaceholder={`在${typeLabel}中搜索...`}
          enablePagination={true}
          showDate={true}
          hideContactColumn={true}
        />
      </div>
    );
  }

  if (selectedContactId) {
    const contact = contacts.find(c => c.id === selectedContactId);
    if (!contact) return <div className="flex-1 min-h-0 flex flex-col"><EmptyState /></div>;
    
    const icon = contact.type === 'person' ? <User className="w-5 h-5" /> : 
                 contact.type === 'group' ? <Users className="w-5 h-5" /> : 
                 <BookOpen className="w-5 h-5" />;

    if (isLoading) {
      return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center bg-white">
          <Loader2 className="w-10 h-10 text-[#A1A1AA] animate-spin mb-4" />
          <p className="text-sm text-[#71717A]">正在加载消息...</p>
        </div>
      );
    }

    if (fetchError) {
      return (
        <div className="flex-1 min-h-0 flex flex-col bg-white">
          <div className="flex flex-col items-center justify-center shrink-0 py-8">
            <p className="text-sm text-red-500 mb-2">加载失败: {fetchError}</p>
            <p className="text-xs text-[#A1A1AA] mb-4">请检查数据库连接或 CLI 是否正常工作</p>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            <MessageTable 
              key={`contact-${selectedContactId}-fallback`}
              messages={filteredMessages}
              title={contact.name}
              icon={icon}
              searchPlaceholder={`在 "${contact.name}" 中搜索...`}
              hideContactColumn={contact.type === 'person'}
              showDate={true}
            />
          </div>
        </div>
      );
    }
                 
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <MessageTable 
          key={`contact-${selectedContactId}`}
          messages={filteredMessages}
          title={contact.name}
          icon={icon}
          searchPlaceholder={`在 "${contact.name}" 中搜索...`}
          hideContactColumn={contact.type === 'person'}
          showDate={true}
        />
      </div>
    );
  }

  if (selectedViewId) {
    return <div className="flex-1 min-h-0 flex flex-col"><GlobalSearch overrideViewId={selectedViewId} /></div>;
  }

  return <div className="flex-1 min-h-0 flex flex-col"><EmptyState /></div>;
}

function EmptyState() {
  const { isInitialized, setShowWizard, setSettingsTab, contacts } = useAppStore();
  const hasSubscriptions = contacts.some(c => c.isSubscribed);

  return (
    <div className="flex flex-col items-center justify-center flex-1 min-h-0 text-[#A1A1AA] bg-[#F9F9FB]">
      <div className="w-24 h-24 bg-[#F4F4F5] rounded-2xl border border-dashed border-[#D4D4D8] flex items-center justify-center mb-6">
        <FolderSync className="w-10 h-10 text-[#A1A1AA]" />
      </div>
      <h2 className="text-xl font-bold text-[#18181B] mb-2 italic tracking-tight">WechatReader</h2>
      {isInitialized ? (
        hasSubscriptions ? (
          <p className="text-sm font-medium">在左侧选择数据源，开启沉浸式查阅</p>
        ) : (
          <div className="flex flex-col items-center mt-4 text-center px-10">
            <p className="text-sm font-medium mb-4 text-[#52525B]">初始化已完成，请先订阅联系人或微信群以加载数据</p>
            <button 
              onClick={() => { setSettingsTab('subs'); setShowWizard(true); }}
              className="px-6 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-[#27272A] transition-colors"
            >
              前往订阅
            </button>
          </div>
        )
      ) : (
        <div className="flex flex-col items-center mt-4">
          <p className="text-sm font-medium mb-4 text-[#52525B]">尚未检测到归档内容，请先初始化配置</p>
          <button 
            onClick={() => { setSettingsTab('db'); setShowWizard(true); }}
            className="px-6 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-[#27272A] transition-colors"
          >
            前往初始化
          </button>
        </div>
      )}
    </div>
  );
}