import React, { useMemo } from 'react';
import { useAppStore } from '../store';
import { Search, Clock, CalendarDays, BookMarked, Paperclip } from 'lucide-react';
import { MessageTable } from './MessageTable';

export function GlobalSearch({ overrideViewId }: { overrideViewId?: number }) {
  const { searchQuery, messages, views, contacts } = useAppStore();
  const subscribedContactIds = useMemo(() => 
    contacts.filter(c => c.isSubscribed).map(c => c.id),
    [contacts]
  );
  
  const view = overrideViewId ? views.find(v => v.id === overrideViewId) : null;
  
  const filteredMessages = useMemo(() => {
    let baseFiltered = messages.filter(m => subscribedContactIds.includes(m.contactId));
    
    // Apply view filters if present
    if (view && view.filters) {
      const { types, contentTypes, timeRange } = view.filters;
      
      if (types && types.length > 0) {
        baseFiltered = baseFiltered.filter(m => types.includes(m.type));
      }
      
      if (contentTypes && contentTypes.length > 0) {
        baseFiltered = baseFiltered.filter(m => contentTypes.includes(m.contentType));
      }
      
      if (timeRange) {
        const now = Date.now();
        if (timeRange === 'today') {
          baseFiltered = baseFiltered.filter(m => (now - m.timestamp) < 24 * 60 * 60 * 1000);
        } else if (timeRange === '7days') {
          baseFiltered = baseFiltered.filter(m => (now - m.timestamp) < 7 * 24 * 60 * 60 * 1000);
        }
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
  }, [messages, view, overrideViewId, searchQuery, subscribedContactIds]);

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

  return (
    <MessageTable 
      key={`global-search-${view?.id || 'search'}-${subscribedContactIds.join(',')}`}
      messages={filteredMessages}
      title={title}
      icon={icon}
      searchPlaceholder={view ? `在"${view.name}"中搜索...` : "搜索结果..."}
    />
  );
}
