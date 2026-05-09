import React, { useMemo, useState } from 'react';
import { useAppStore } from '../store';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { FileText, Search, SearchX, Download, Clock, CalendarDays, BookMarked, Paperclip } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function GlobalSearch({ overrideViewId }: { overrideViewId?: number }) {
  const { searchQuery, messages, views, contacts } = useAppStore();
  const [viewSearchQuery, setViewSearchQuery] = useState('');
  
  const view = overrideViewId ? views.find(v => v.id === overrideViewId) : null;
  
  const results = useMemo(() => {
    let filtered = messages;
    
    // Apply search query
    const activeSearchQuery = overrideViewId ? viewSearchQuery : searchQuery;
    if (activeSearchQuery) {
      const q = activeSearchQuery.toLowerCase();
      filtered = filtered.filter(m => 
        (m.content && m.content.toLowerCase().includes(q)) || 
        (m.senderName && m.senderName.toLowerCase().includes(q))
      );
    }
    
    // Apply view filters
    if (view && view.filters) {
      const { types, contentTypes, timeRange } = view.filters;
      
      if (types && types.length > 0) {
        filtered = filtered.filter(m => types.includes(m.type));
      }
      
      if (contentTypes && contentTypes.length > 0) {
        filtered = filtered.filter(m => contentTypes.includes(m.contentType));
      }
      
      if (timeRange) {
        const now = Date.now();
        if (timeRange === 'today') {
          // Simplistic today logic for mock data
          filtered = filtered.filter(m => (now - m.timestamp) < 24 * 60 * 60 * 1000);
        } else if (timeRange === '7days') {
          filtered = filtered.filter(m => (now - m.timestamp) < 7 * 24 * 60 * 60 * 1000);
        }
      }
    }
    
    return filtered.sort((a, b) => b.timestamp - a.timestamp);
  }, [searchQuery, viewSearchQuery, messages, view, overrideViewId]);

  const getContactName = (contactId: string) => {
    return contacts.find(c => c.id === contactId)?.name || '未知来源';
  };

  return (
    <div className="flex flex-col h-full bg-[#F9F9FB]">
      <div className="px-8 py-6 bg-white border-b border-[#E4E4E7] shadow-sm z-10 shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#18181B] flex items-center">
            {view ? (
              <>
                <span className="mr-3 p-1.5 bg-[#F4F4F5] rounded text-lg flex items-center justify-center">
                  {view.id === 1 && <Clock className="w-5 h-5" />}
                  {view.id === 2 && <CalendarDays className="w-5 h-5" />}
                  {view.id === 3 && <BookMarked className="w-5 h-5" />}
                  {view.id === 4 && <Paperclip className="w-5 h-5" />}
                  {![1, 2, 3, 4].includes(view.id) && view.icon}
                </span>
                {view.name}
              </>
            ) : (
              <>
                <div className="w-8 h-8 rounded bg-black flex items-center justify-center mr-3">
                   <Search className="w-4 h-4 text-white" />
                </div>
                搜索结果
                <span className="ml-3 font-normal text-[#71717A] italic">"{searchQuery}"</span>
              </>
            )}
          </h2>
          <div className="flex items-center gap-3 mt-4">
             <div className="w-6 h-6 bg-[#E4E4E7] rounded flex items-center justify-center text-[10px] font-bold text-[#18181B] italic">{results.length}</div>
             <span className="text-[10px] text-[#A1A1AA] uppercase tracking-wider font-bold">条记录</span>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {view && (
            <div className="relative w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#A1A1AA]" />
              <Input 
                placeholder={`在"${view.name}"中搜索...`}
                className="pl-9 h-9 text-sm bg-[#F4F4F5] border-transparent focus-visible:ring-black focus-visible:bg-white rounded-lg transition-all"
                value={viewSearchQuery}
                onChange={(e) => setViewSearchQuery(e.target.value)}
              />
            </div>
          )}
          <Button variant="outline" size="sm" className="hidden sm:flex border-[#E4E4E7] hover:bg-[#F4F4F5] text-[#18181B] bg-white h-9">
            <Download className="w-4 h-4 mr-2" />
            导出
          </Button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto space-y-4 flex flex-col items-center w-full">
          {results.length === 0 ? (
             <div className="flex flex-col items-center justify-center py-20 text-[#A1A1AA] space-y-4">
               <div className="w-16 h-16 bg-[#F4F4F5] rounded-xl border border-dashed border-[#D4D4D8] flex items-center justify-center">
                 <SearchX className="w-8 h-8 text-[#A1A1AA]" />
               </div>
               <p className="text-sm font-medium">没有匹配的归档记录</p>
             </div>
          ) : (
            results.map((msg) => (
              <div key={msg.id} className="w-full bg-white border border-[#E4E4E7] rounded-xl p-5 shadow-sm hover:border-black hover:shadow-md transition-all cursor-pointer">
                <div className="flex items-center justify-between mb-4 border-b border-[#F4F4F5] pb-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-semibold text-[#18181B]">{getContactName(msg.contactId)}</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#D4D4D8]" />
                    <span className="text-[#71717A]">{msg.senderName || (msg.senderId === 'me' ? '我' : '系统')}</span>
                    {msg.type === 'group' && <span className="text-[10px] bg-[#F4F4F5] text-[#71717A] px-2 py-0.5 rounded uppercase font-bold">群聊</span>}
                  </div>
                  <span className="text-[10px] text-[#A1A1AA] uppercase tracking-wider font-bold">
                    {format(msg.timestamp, 'yyyy-MM-dd HH:mm')}
                  </span>
                </div>
                
                {msg.contentType === 'file' ? (
                  <div className="flex items-center p-3 bg-[#F4F4F5] rounded border border-[#E4E4E7] w-fit">
                    <div className="w-8 h-8 bg-white border border-[#E4E4E7] rounded flex items-center justify-center mr-3 shadow-sm">
                       <FileText className="w-4 h-4 text-[#52525B]" />
                    </div>
                    <span className="text-sm font-medium text-[#18181B]">{msg.content}</span>
                  </div>
                ) : msg.contentType === 'image' ? (
                  <div className="inline-flex mt-1 text-[10px] text-[#A1A1AA] bg-[#F4F4F5] px-2 py-1 rounded border border-[#E4E4E7] uppercase font-bold">
                    图片记录
                  </div>
                ) : (
                  <p className="text-[#52525B] text-sm leading-relaxed whitespace-pre-wrap mt-2">
                    {msg.content}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
