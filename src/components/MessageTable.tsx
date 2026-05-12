import React, { useMemo, useState, useEffect } from 'react';
import { format } from 'date-fns';
import { FileText, Search, SearchX, Download, Clock, CalendarDays, BookMarked, Paperclip, Filter, Check, ChevronLeft, ChevronRight, RefreshCw, BarChart3, PanelRightClose, PanelRight, ExternalLink, Globe, Image as ImageIcon, File, Link as LinkIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../store';
import { WeChatMessage } from '../types';
import { openUrl } from '../lib/tauri';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

interface MessageTableProps {
  messages: WeChatMessage[];
  title: string | React.ReactNode;
  icon?: React.ReactNode;
  searchPlaceholder?: string;
  showFilters?: boolean;
  /** When true, pagination is handled internally (search/filters work on full dataset) */
  enablePagination?: boolean;
  /** When true, show date (MM-dd) in time column instead of just time */
  showDate?: boolean;
  /** When true, hide the contact/chat column */
  hideContactColumn?: boolean;
  /** When true, show detail/analysis toggle in title bar */
  showAnalysisToggle?: boolean;
  /** Callback when refresh is triggered */
  onRefresh?: () => void;
}

function FilterMenu({ title, options, selected, onToggle }: { title: string, options: string[], selected: Set<string>, onToggle: (val: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-1 hover:text-[#18181B] focus:outline-none">
        {title} <Filter className={`w-3 h-3 ${selected.size > 0 ? 'text-blue-500' : 'text-[#A1A1AA]'}`} />
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput placeholder={`搜索${title}...`} className="h-9 outline-none border-none ring-0 focus:ring-0 focus:outline-none" />
          <CommandList>
            <CommandEmpty>未找到结果。</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.has(option);
                return (
                  <CommandItem
                    key={option}
                    onSelect={() => {
                      onToggle(option);
                    }}
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50 [&_svg]:invisible"
                      )}
                    >
                      <Check className={cn("h-4 w-4")} />
                    </div>
                    <span>{option}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function MessageTable({ messages, title, icon, searchPlaceholder, showFilters = true, enablePagination = false, showDate = false, hideContactColumn = false, showAnalysisToggle = false, onRefresh }: MessageTableProps) {
  const { 
    contacts, 
    isRightPanelOpen, 
    setRightPanelOpen, 
    rightPanelTab, 
    setRightPanelTab, 
    selectedMessageId, 
    selectMessage,
    selectedContactId 
  } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [selectedContentTypes, setSelectedContentTypes] = useState<Set<string>>(new Set());
  const [selectedSenders, setSelectedSenders] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

  const [currentPage, setCurrentPage] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const getContactName = (contactId: string) => {
    // Try lookup by WeChat username (id) first (for mock data)
    const byId = contacts.find(c => c.id === contactId);
    if (byId) return byId.name;
    // For server-fetched messages, contactId is already the display name
    if (contactId) return contactId;
    return '未知来源';
  };

  const { results, filterOptions, totalCount } = useMemo(() => {
    let filtered = messages;

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(m => 
        (m.content && m.content.toLowerCase().includes(q)) || 
        (m.senderName && m.senderName.toLowerCase().includes(q)) ||
        getContactName(m.contactId).toLowerCase().includes(q)
      );
    }

    // Static filter options calculation before dynamic filters
    const contactsSet = new Set<string>();
    const contentTypesSet = new Set<string>();
    const sendersSet = new Set<string>();
    const groupsSet = new Set<string>();

    filtered.forEach(m => {
      contactsSet.add(getContactName(m.contactId));
      contentTypesSet.add(
        m.contentType === 'text' ? '文本' : 
        m.contentType === 'image' ? '图片' : 
        m.contentType === 'voice' ? '声音' : 
        m.contentType === 'file' ? '文件' : 
        m.contentType === 'video' ? '视频' : 
        m.contentType === 'article' ? '文章' : 
        m.contentType === 'link' ? '链接' : m.contentType
      );
      sendersSet.add(m.senderName || (m.senderId === 'me' ? '我' : '系统'));
      groupsSet.add(m.type === 'person' ? '联系人' : m.type === 'group' ? '微信群' : '公众号');
    });

    // Dynamic filters
    if (selectedContacts.size > 0) {
      filtered = filtered.filter(m => selectedContacts.has(getContactName(m.contactId)));
    }
    if (selectedContentTypes.size > 0) {
      filtered = filtered.filter(m => {
        const typeName = m.contentType === 'text' ? '文本' : 
                         m.contentType === 'image' ? '图片' : 
                         m.contentType === 'voice' ? '声音' : 
                         m.contentType === 'file' ? '文件' : 
                         m.contentType === 'video' ? '视频' : 
                         m.contentType === 'article' ? '文章' : 
                         m.contentType === 'link' ? '链接' : m.contentType;
        return selectedContentTypes.has(typeName);
      });
    }
    if (selectedSenders.size > 0) {
      filtered = filtered.filter(m => selectedSenders.has(m.senderName || (m.senderId === 'me' ? '我' : '系统')));
    }
    if (selectedGroups.size > 0) {
      filtered = filtered.filter(m => {
        const groupName = m.type === 'person' ? '联系人' : m.type === 'group' ? '微信群' : '公众号';
        return selectedGroups.has(groupName);
      });
    }

    return {
      results: filtered.sort((a, b) => b.timestamp - a.timestamp),
      filterOptions: {
        contacts: Array.from(contactsSet).sort(),
        contentTypes: Array.from(contentTypesSet).sort(),
        senders: Array.from(sendersSet).filter(Boolean).sort(),
        groups: Array.from(groupsSet).sort(),
      },
      totalCount: filtered.length,
    };
  }, [messages, searchQuery, contacts, selectedContacts, selectedContentTypes, selectedSenders, selectedGroups]);

  // Paginate results if enabled
  const pagedResults = useMemo(() => {
    if (!enablePagination) return results;
    const start = currentPage * PAGE_SIZE;
    return results.slice(start, start + PAGE_SIZE);
  }, [results, currentPage, enablePagination]);

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const hasMore = (currentPage + 1) * PAGE_SIZE < results.length;

  // Reset page when filters/search change
  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery, selectedContacts, selectedContentTypes, selectedSenders, selectedGroups]);

  // Close right panel when message is deselected (e.g., switching contacts)
  useEffect(() => {
    if (!selectedMessageId && isRightPanelOpen && !showAnalysisToggle) {
      setRightPanelOpen(false);
    }
  }, [selectedMessageId]);

  const toggleFilter = (set: Set<string>, value: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    const next = new Set(set);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    setter(next);
  };

  const selectedMessage = useMemo(() => {
    return messages.find(m => m.id === selectedMessageId);
  }, [messages, selectedMessageId]);

  const isSelectedContactGroup = useMemo(() => {
    if (!selectedContactId) return false;
    const contact = contacts.find(c => c.id === selectedContactId);
    return contact?.type === 'group';
  }, [contacts, selectedContactId]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    if (onRefresh) {
      onRefresh();
    }
    setTimeout(() => {
      setIsRefreshing(false);
    }, 600);
  };

  const isRichMediaMessage = (msg: WeChatMessage) => {
    return ['image', 'file', 'link', 'article', 'video', 'voice'].includes(msg.contentType);
  };

  const handleRowClick = (msg: WeChatMessage) => {
    selectMessage(msg.id);
  };

  const handleOpenUrl = async (url: string) => {
    try {
      await openUrl(url);
    } catch (err) {
      console.warn('openUrl invoke failed, fallback to window.open:', err);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleExportCSV = () => {
    const headers = ['时间', '会话', '类型', '发信人', '内容', '归属', '链接'];
    const escapeCsv = (str: string) => `"${str.replace(/"/g, '""')}"`;
    const rows = results.map(msg => [
      format(msg.timestamp, 'yyyy-MM-dd HH:mm:ss'),
      getContactName(msg.contactId),
      msg.contentType === 'text' ? '文本' : 
      msg.contentType === 'image' ? '图片' : 
      msg.contentType === 'voice' ? '声音' : 
      msg.contentType === 'file' ? '文件' : 
      msg.contentType === 'video' ? '视频' : 
      msg.contentType === 'article' ? '文章' : 
      msg.contentType === 'link' ? '链接' : msg.contentType,
      msg.senderName || (msg.senderId === 'me' ? '我' : '系统'),
      msg.content || '',
      msg.type === 'person' ? '联系人' : msg.type === 'group' ? '微信群' : '公众号',
      msg.metadata?.url || ''
    ]);
    const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => escapeCsv(String(cell))).join(','))].join('\n');
    
    // Add BOM for Excel
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `export_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex h-full w-full bg-[#f9f9fb] relative">
      <div className={cn("flex flex-col h-full bg-white flex-1 min-w-0 transition-all", isRightPanelOpen ? "border-r border-[#E4E4E7]" : "")}>
      {/* Fixed top: title bar */}
      <div className="px-6 py-4 bg-white border-b border-[#E4E4E7] shrink-0 flex items-center justify-between" style={{ height: '69px' }}>
        <div className="flex items-center">
          <h2 className="text-xl font-semibold tracking-tight text-[#18181B] flex items-center">
            {icon && <span className="mr-3 text-[#71717A] flex items-center justify-center">{icon}</span>}
            {title}
          </h2>
          <div className="flex items-center gap-2 ml-4 text-[10px] font-bold uppercase tracking-wider">
             <span className="bg-[#F4F4F5] px-2 py-0.5 rounded-full text-[#18181B]">
                {totalCount} 条记录
             </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {showAnalysisToggle && (
            <div className="flex bg-[#F4F4F5] p-1 rounded-lg border border-[#E4E4E7]">
              <button
                onClick={() => {
                  if (isRightPanelOpen && rightPanelTab === 'detail') {
                    setRightPanelOpen(false);
                  } else {
                    setRightPanelOpen(true);
                    setRightPanelTab('detail');
                  }
                }}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center",
                  isRightPanelOpen && rightPanelTab === 'detail' 
                    ? "bg-white text-black shadow-sm" 
                    : "text-[#71717A] hover:text-[#18181B]"
                )}
                title="查看详情"
              >
                <FileText className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  if (isRightPanelOpen && rightPanelTab === 'analysis') {
                    setRightPanelOpen(false);
                  } else {
                    setRightPanelOpen(true);
                    setRightPanelTab('analysis');
                  }
                }}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center",
                  isRightPanelOpen && rightPanelTab === 'analysis' 
                    ? "bg-white text-black shadow-sm" 
                    : "text-[#71717A] hover:text-[#18181B]"
                )}
                title="数据分析"
              >
                <BarChart3 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Fixed top: search bar */}
      <div className="shrink-0 bg-white px-3 py-3 flex items-center justify-between border-b border-[#E4E4E7]">
        <div className="relative w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#A1A1AA]" />
          <Input 
            placeholder={searchPlaceholder || "搜索归档记录..."}
            className="pl-9 h-9 text-sm bg-white border border-[#E4E4E7] ring-0 focus-visible:ring-0 focus-visible:border-black rounded-none transition-all"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm" className="hidden sm:flex border border-[#E4E4E7] rounded-none hover:bg-[#F4F4F5] text-[#18181B] bg-white h-9 text-xs">
            <RefreshCw className={cn("w-3 h-3 mr-1.5", isRefreshing ? "animate-spin" : "")} />
            刷新
          </Button>
          <Button onClick={handleExportCSV} variant="outline" size="sm" className="hidden sm:flex border border-[#E4E4E7] rounded-none hover:bg-[#F4F4F5] text-[#18181B] bg-white h-9 text-xs">
            <Download className="w-3 h-3 mr-1.5" />
            导出
          </Button>
        </div>
      </div>

      {/* Scrollable table body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#A1A1AA] space-y-4">
            <div className="w-16 h-16 bg-[#F4F4F5] rounded-xl border border-dashed border-[#D4D4D8] flex items-center justify-center">
              <SearchX className="w-8 h-8 text-[#A1A1AA]" />
            </div>
            <p className="text-sm font-medium">没有匹配的归档记录</p>
          </div>
        ) : (
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#F4F4F5] text-[#71717A] text-xs uppercase font-semibold border-b border-[#E4E4E7] sticky top-0 z-20">
              <tr>
                <th className="px-6 py-3 font-medium">时间</th>
                {!hideContactColumn && (
                  <th className="px-6 py-3 font-medium">
                    <FilterMenu 
                      title="会话" 
                      options={filterOptions.contacts} 
                      selected={selectedContacts} 
                      onToggle={(c) => toggleFilter(selectedContacts, c, setSelectedContacts)} 
                    />
                  </th>
                )}
                <th className="px-6 py-3 font-medium">
                  <FilterMenu 
                    title="类型" 
                    options={filterOptions.contentTypes} 
                    selected={selectedContentTypes} 
                    onToggle={(c) => toggleFilter(selectedContentTypes, c, setSelectedContentTypes)} 
                  />
                </th>
                <th className="px-6 py-3 font-medium">
                  <FilterMenu 
                    title="发送者" 
                    options={filterOptions.senders} 
                    selected={selectedSenders} 
                    onToggle={(s) => toggleFilter(selectedSenders, s, setSelectedSenders)} 
                  />
                </th>
                <th className="px-6 py-3 font-medium">内容</th>
                {!hideContactColumn && (
                  <th className="px-6 py-3 font-medium">
                    <FilterMenu 
                      title="归属" 
                      options={filterOptions.groups} 
                      selected={selectedGroups} 
                      onToggle={(g) => toggleFilter(selectedGroups, g, setSelectedGroups)} 
                    />
                  </th>
                )}
                <th className="px-6 py-3 font-medium">链接</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E4E7] bg-white">
              {(enablePagination ? pagedResults : results).map((msg) => (
                <tr 
                  key={msg.id} 
                  onClick={() => handleRowClick(msg)}
                  className={cn(
                    "hover:bg-[#F4F4F5] transition-colors cursor-pointer group",
                    selectedMessageId === msg.id && "bg-blue-50/50"
                  )}
                >
                  <td className="px-6 py-4 text-xs whitespace-nowrap font-mono text-[#A1A1AA]">
                    {showDate ? format(msg.timestamp, 'MM-dd HH:mm') : format(msg.timestamp, 'HH:mm:ss')}
                  </td>
                  {!hideContactColumn && (
                    <td className="px-6 py-4 whitespace-nowrap text-[#18181B]">
                      {getContactName(msg.contactId)}
                    </td>
                  )}
                  <td className="px-6 py-4 text-[#52525B] whitespace-nowrap">
                    {msg.contentType === 'text' ? '文本' : 
                     msg.contentType === 'image' ? '图片' : 
                     msg.contentType === 'voice' ? '声音' : 
                     msg.contentType === 'file' ? '文件' : 
                     msg.contentType === 'video' ? '视频' : 
                     msg.contentType === 'article' ? '文章' : 
                     msg.contentType === 'link' ? '链接' : msg.contentType}
                  </td>
                  <td className="px-6 py-4 text-[#52525B] whitespace-nowrap">
                    {msg.senderName || (msg.senderId === 'me' ? '我' : '系统')}
                  </td>
                  <td className="px-6 py-4 text-[#52525B] max-w-[300px] truncate group-hover:text-black transition-colors" title={msg.contentType === 'article' ? (msg.metadata?.title || msg.content) : msg.content}>
                    {msg.contentType === 'file' ? (
                      <div className="flex items-center text-[#18181B] font-medium"><FileText className="w-4 h-4 mr-1.5 text-[#A1A1AA]"/> {msg.content}</div>
                    ) : msg.contentType === 'image' ? (
                      <span className="text-[#A1A1AA]">[图片]</span>
                    ) : msg.contentType === 'voice' ? (
                      <span className="text-[#A1A1AA]">[声音时长: {msg.metadata?.duration || 0}s]</span>
                    ) : msg.contentType === 'article' ? (
                      <div className="flex items-center gap-1.5">
                        <BookMarked className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-[#18181B] font-medium truncate">{msg.metadata?.title || msg.content.replace('[链接]', '').replace('[链接/文件]', '').replace(/\s*https?:\/\/\S+/, '').trim() || '公众号文章'}</span>
                      </div>
                    ) : msg.contentType === 'link' ? (
                      <div className="flex items-center gap-1.5">
                        <LinkIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="truncate">{msg.metadata?.title || msg.content.replace('[链接]', '').replace('[链接/文件]', '').replace(/\s*https?:\/\/\S+/, '').trim() || msg.content}</span>
                      </div>
                    ) : (
                      <span>{msg.content}</span>
                    )}
                  </td>
                  {!hideContactColumn && (
                    <td className="px-6 py-4 text-[#52525B] whitespace-nowrap">
                      {msg.type === 'person' ? '联系人' : msg.type === 'group' ? '微信群' : '公众号'}
                    </td>
                  )}
                  <td className="px-6 py-4 text-blue-600 hover:text-blue-800 whitespace-nowrap truncate max-w-[150px]">
                    {msg.metadata?.url ? (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleOpenUrl(msg.metadata!.url!); }}
                        className="hover:underline flex items-center gap-1"
                      >
                        {(msg.contentType === 'article' || msg.contentType === 'link') ? (
                          <><Globe className="w-3 h-3" /> 打开</>
                        ) : (
                          <><ExternalLink className="w-3 h-3" /> 打开</>
                        )}
                      </button>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Fixed bottom: pagination */}
      {enablePagination && results.length > PAGE_SIZE && (
        <div className="shrink-0 flex items-center justify-center gap-3 py-3 border-t border-[#E4E4E7] bg-white">
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className={`p-1.5 rounded transition-colors ${currentPage === 0 ? 'text-[#D4D4D8] cursor-not-allowed' : 'text-[#52525B] hover:bg-[#F4F4F5]'}`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-[#71717A] font-medium">
            第 {currentPage + 1}/{totalPages} 页（共 {results.length} 条）
          </span>
          <button
            onClick={() => setCurrentPage(p => p + 1)}
            disabled={!hasMore}
            className={`p-1.5 rounded transition-colors ${!hasMore ? 'text-[#D4D4D8] cursor-not-allowed' : 'text-[#52525B] hover:bg-[#F4F4F5]'}`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
      </div>

      {/* Right Panel */}
      {isRightPanelOpen && (showAnalysisToggle || selectedMessageId) && (
        <div className="w-[340px] shrink-0 border-l border-[#E4E4E7] h-full bg-white flex flex-col overflow-hidden hidden md:flex z-20">
          <div className="flex items-center justify-between px-5 border-b border-[#E4E4E7] bg-white shrink-0" style={{ height: '69px' }}>
            <h3 className="text-sm font-semibold text-[#18181B]">消息详情</h3>
            <button 
              onClick={() => { setRightPanelOpen(false); selectMessage(null); }}
              className="p-1.5 rounded-md hover:bg-[#F4F4F5] text-[#71717A] transition-colors"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
          
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-[#FAFAFA]">
            {rightPanelTab === 'analysis' ? (
              <div className="p-5 space-y-6">
                {(() => {
                  const isOfficialAccountOnly = (results.length > 0 && results.every(m => m.type === 'official_account')) || (typeof title === 'string' && title === '公众号文章');
                  const isGroupOnly = results.length > 0 && results.every(m => m.type === 'group');
                  const isMixed = !isOfficialAccountOnly && !isGroupOnly;

                  return (
                    <>
                      <div className="mb-4">
                        <h3 className="text-[16px] font-semibold tracking-tight text-[#18181B] flex items-center">
                          <span className="w-1.5 h-4 bg-blue-600 rounded-sm mr-2.5 inline-block"></span>
                          当前结果分析
                        </h3>
                        <p className="text-xs text-[#A1A1AA] mt-1.5 ml-4">基于当前 {results.length} 条记录</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white border text-sm border-[#E4E4E7] rounded-[10px] p-3.5 shadow-sm">
                          <div className="text-[12px] text-[#71717A] mb-1">{isOfficialAccountOnly ? '文章总数' : '消息总数'}</div>
                          <div className="text-xl font-semibold text-[#18181B] font-mono">{totalCount}</div>
                        </div>
                        <div className="bg-white border text-sm border-[#E4E4E7] rounded-[10px] p-3.5 shadow-sm">
                          <div className="text-[12px] text-[#71717A] mb-1">{
                            isOfficialAccountOnly ? '涉及公众号' : 
                            isGroupOnly ? '发言成员' : 
                            '触达联系人'
                          }</div>
                          <div className="text-xl font-semibold text-[#18181B] font-mono">{
                            isGroupOnly ? filterOptions.senders.length : filterOptions.contacts.length
                          }</div>
                        </div>
                        <div className="bg-white border text-sm border-[#E4E4E7] rounded-[10px] p-3.5 shadow-sm">
                          <div className="text-[12px] text-[#71717A] mb-1">高峰时段</div>
                          <div className="text-lg font-semibold text-[#18181B] font-mono mt-0.5">
                            {(() => {
                              if (results.length === 0) return '-';
                              const hourCounts = results.reduce((acc, msg) => {
                                const hour = new Date(msg.timestamp).getHours();
                                acc[hour] = (acc[hour] || 0) + 1;
                                return acc;
                              }, {} as Record<number, number>);
                              const topHour = Object.entries(hourCounts).sort(([,a], [,b]) => (b as number) - (a as number))[0];
                              return topHour ? `${topHour[0]}:00` : '-';
                            })()}
                          </div>
                        </div>
                      </div>

                      {!isOfficialAccountOnly && (
                        <>
                          <div className="bg-white border text-sm border-[#E4E4E7] rounded-[10px] p-4 shadow-sm">
                            <h4 className="font-medium text-[#18181B] pb-3 text-[13px] border-b border-[#F4F4F5] mb-3">内容格式</h4>
                            <div className="space-y-3.5">
                              {['文本', '图片', '文章'].map(type => {
                                const count = results.filter(m => 
                                  (type === '文本' && m.contentType === 'text') ||
                                  (type === '图片' && m.contentType === 'image') ||
                                  (type === '文章' && m.contentType === 'article')
                                ).length;
                                const percent = totalCount > 0 ? Math.round(count / totalCount * 100) : 0;
                                return (
                                  <div key={type}>
                                    <div className="flex justify-between text-xs mb-1.5 flex-row">
                                      <span className="text-[#52525B]">{type}</span>
                                      <span className="text-[#18181B] font-medium font-mono text-[11px]">
                                        {percent}% <span className="text-[#A1A1AA] ml-1">({count})</span>
                                      </span>
                                    </div>
                                    <div className="h-1.5 w-full bg-[#F4F4F5] rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${percent}%` }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          
                          {isMixed && (
                            <div className="bg-white border text-sm border-[#E4E4E7] rounded-[10px] p-4 shadow-sm">
                              <h4 className="font-medium text-[#18181B] pb-3 text-[13px] border-b border-[#F4F4F5] mb-3">消息来源</h4>
                              <div className="space-y-3.5">
                                {['联系人', '微信群', '公众号'].map(typeLabel => {
                                  const count = results.filter(m => 
                                    (typeLabel === '联系人' && m.type === 'person') ||
                                    (typeLabel === '微信群' && m.type === 'group') ||
                                    (typeLabel === '公众号' && m.type === 'official_account')
                                  ).length;
                                  const percent = totalCount > 0 ? Math.round(count / totalCount * 100) : 0;
                                  const colorClass = typeLabel === '微信群' ? 'bg-indigo-500' : typeLabel === '公众号' ? 'bg-emerald-500' : 'bg-blue-500';
                                  return (
                                    <div key={typeLabel}>
                                      <div className="flex justify-between text-xs mb-1.5 flex-row">
                                        <span className="text-[#52525B]">{typeLabel}</span>
                                        <span className="text-[#18181B] font-medium font-mono text-[11px]">
                                          {percent}% <span className="text-[#A1A1AA] ml-1">({count})</span>
                                        </span>
                                      </div>
                                      <div className="h-1.5 w-full bg-[#F4F4F5] rounded-full overflow-hidden">
                                        <div className={`h-full ${colorClass} rounded-full`} style={{ width: `${percent}%` }} />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {(!selectedContactId || isSelectedContactGroup) && (
                        <div className="bg-white border text-sm border-[#E4E4E7] rounded-[10px] p-4 shadow-sm">
                          <h4 className="font-medium text-[#18181B] pb-3 text-[13px] border-b border-[#F4F4F5] mb-3">{isOfficialAccountOnly ? '活跃公众号' : '最活跃发送者'}</h4>
                          <div className="space-y-0 text-[13px]">
                            {(() => {
                              if (results.length === 0) return <div className="text-[#A1A1AA] text-xs">暂无活跃发送者</div>;
                              const senderCounts = results.reduce((acc, msg) => {
                                const name = msg.senderName || getContactName(msg.contactId);
                                acc[name] = (acc[name] || 0) + 1;
                                return acc;
                              }, {} as Record<string, number>);
                              
                              const topSenders = Object.entries(senderCounts)
                                .sort(([,a], [,b]) => (b as number) - (a as number))
                                .slice(0, 5);
                              
                              return topSenders.map(([name, count], idx) => (
                                <div key={name} className="flex justify-between items-center py-2 border-b border-[#F4F4F5] last:border-0 hover:bg-[#FAFAFA] px-1 -mx-1 rounded">
                                  <div className="flex items-center gap-2 overflow-hidden">
                                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${idx < 3 ? 'bg-orange-100 text-orange-700' : 'bg-[#F4F4F5] text-[#71717A]'}`}>
                                      {idx + 1}
                                    </span>
                                    <span className="text-[#3F3F46] truncate">{name}</span>
                                  </div>
                                  <span className="font-semibold text-[#18181B] font-mono text-[12px]">{count}</span>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="p-5 space-y-6">
                {selectedMessage ? (
                  <div className="space-y-5">
                    {/* Type badge & Record ID */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-50 border border-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider">
                        <span className="w-1 h-1 bg-amber-500 rounded-full animate-pulse" />
                        只读存档
                      </div>
                      <span className="text-[10px] text-[#A1A1AA] font-medium">#{selectedMessage.id.slice(0, 8)}</span>
                    </div>

                    {/* Basic info card */}
                    <div className="p-4 bg-white border border-[#E4E4E7] rounded-xl shadow-sm space-y-4">
                      <div>
                        <label className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-wider block mb-1">发送时间</label>
                        <div className="text-sm text-[#18181B] font-medium flex items-center gap-2">
                          <CalendarDays className="w-4 h-4 text-[#A1A1AA]" />
                          {format(selectedMessage.timestamp, 'yyyy-MM-dd HH:mm:ss')}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-wider block mb-1">发送者</label>
                          <div className="text-sm text-[#18181B] font-medium truncate">
                            {selectedMessage.senderName || (selectedMessage.senderId === 'me' ? '我' : '系统')}
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-wider block mb-1">会话</label>
                          <div className="text-sm text-[#18181B] font-medium truncate">
                            {getContactName(selectedMessage.contactId)}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-wider block mb-1">消息类型</label>
                        <div className={cn(
                          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[12px] font-medium",
                          selectedMessage.contentType === 'image' ? 'bg-purple-50 text-purple-700' :
                          selectedMessage.contentType === 'file' ? 'bg-orange-50 text-orange-700' :
                          selectedMessage.contentType === 'link' ? 'bg-blue-50 text-blue-700' :
                          selectedMessage.contentType === 'article' ? 'bg-emerald-50 text-emerald-700' :
                          selectedMessage.contentType === 'voice' ? 'bg-green-50 text-green-700' :
                          selectedMessage.contentType === 'video' ? 'bg-red-50 text-red-700' :
                          'bg-[#F4F4F5] text-[#71717A]'
                        )}>
                          {selectedMessage.contentType === 'image' ? <><ImageIcon className="w-3 h-3" /> 图片消息</> :
                           selectedMessage.contentType === 'file' ? <><FileText className="w-3 h-3" /> 文件传输</> :
                           selectedMessage.contentType === 'link' ? <><LinkIcon className="w-3 h-3" /> 链接消息</> :
                           selectedMessage.contentType === 'article' ? <><BookMarked className="w-3 h-3" /> 公众号文章</> :
                           selectedMessage.contentType === 'voice' ? '语音消息' :
                           selectedMessage.contentType === 'video' ? '视频消息' :
                           '纯文本'}
                        </div>
                      </div>
                    </div>

                    {/* Content area - different renderings per type */}
                    <div className="p-5 bg-white border border-[#E4E4E7] rounded-xl shadow-sm">
                      <label className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-wider block mb-3">消息内容</label>
                      
                      {/* Image message */}
                      {selectedMessage.contentType === 'image' && (
                        <div className="space-y-3">
                          {selectedMessage.metadata?.filePath && !selectedMessage.metadata.filePath.startsWith('img:') ? (
                            <div 
                              className="rounded-lg border border-[#E4E4E7] overflow-hidden cursor-zoom-in hover:opacity-90 transition-opacity bg-gray-50"
                              onClick={() => setPreviewImage(selectedMessage.metadata?.filePath || null)}
                            >
                              <img 
                                src={`/api/file?path=${encodeURIComponent(selectedMessage.metadata.filePath)}`}
                                alt="图片"
                                className="w-full h-auto max-h-[400px] object-contain bg-gray-50"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  const parent = target.parentElement;
                                  if (parent) {
                                    parent.className = 'p-6 text-center rounded-lg border border-[#E4E4E7] bg-amber-50';
                                    parent.onclick = null;
                                    parent.style.cursor = 'default';
                                    parent.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 text-amber-300 mx-auto mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><p class="text-xs text-amber-600 font-medium">图片解密失败</p><p class="text-[10px] text-amber-400 mt-1">微信版本更新可能导致加密方式变化</p><p class="text-[10px] text-amber-400 mt-0.5 break-all max-w-[280px]">${selectedMessage.metadata?.filePath || ''}</p>`;
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <div className="p-6 text-center rounded-lg border border-[#E4E4E7] bg-gray-50">
                              <ImageIcon className="w-12 h-12 text-[#D4D4D8] mx-auto mb-2" />
                              <p className="text-xs text-[#A1A1AA]">图片文件不可用</p>
                              {selectedMessage.metadata?.filePath && (
                                <p className="text-[10px] text-[#D4D4D8] mt-1 break-all">{selectedMessage.metadata.filePath}</p>
                              )}
                              <p className="text-[10px] text-[#D4D4D8] mt-1">请确认微信数据目录中的图片文件存在且可解密</p>
                            </div>
                          )}
                          {selectedMessage.content !== '[图片]' && (
                            <p className="text-xs text-[#71717A] break-all">{selectedMessage.content.replace('[图片]', '').replace(/\(local_id=\d+\)/, '').replace(/\/\S+/g, '').trim()}</p>
                          )}
                        </div>
                      )}

                      {/* Link message */}
                      {selectedMessage.contentType === 'link' && (
                        <div className="space-y-4">
                          <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50/50 border border-blue-100">
                            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                              <LinkIcon className="w-5 h-5 text-blue-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-[#18181B] break-words">
                                {selectedMessage.metadata?.title || selectedMessage.content.replace('[链接]', '').replace('[链接/文件]', '').replace(/\s*https?:\/\/\S+/, '').trim() || '链接消息'}
                              </div>
                              {selectedMessage.metadata?.url && (
                                <p className="text-xs text-blue-500 mt-1 truncate" title={selectedMessage.metadata.url}>
                                  {selectedMessage.metadata.url}
                                </p>
                              )}
                            </div>
                          </div>
                          {selectedMessage.metadata?.url && (
                            <button
                              onClick={() => handleOpenUrl(selectedMessage.metadata!.url!)}
                              className="flex items-center justify-center w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors gap-2"
                            >
                              <Globe className="w-4 h-4" />
                              在浏览器中打开
                            </button>
                          )}
                        </div>
                      )}

                      {/* Article / Official account message */}
                      {selectedMessage.contentType === 'article' && (
                        <div className="space-y-4">
                          <div className="p-4 rounded-lg bg-emerald-50/50 border border-emerald-100">
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                                <BookMarked className="w-5 h-5 text-emerald-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-[#18181B] leading-snug break-words">
                                  {selectedMessage.metadata?.title || selectedMessage.content.replace('[链接]', '').replace('[链接/文件]', '').replace(/\s*https?:\/\/\S+/, '').trim() || '公众号文章'}
                                </div>
                                {selectedMessage.metadata?.digest && (
                                  <p className="text-xs text-[#71717A] mt-1.5 break-words line-clamp-3">{selectedMessage.metadata.digest}</p>
                                )}
                                {selectedMessage.metadata?.url && (
                                  <p className="text-xs text-emerald-500 mt-1.5 truncate" title={selectedMessage.metadata.url}>
                                    mp.weixin.qq.com
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          {selectedMessage.metadata?.url && (
                            <button
                              onClick={() => handleOpenUrl(selectedMessage.metadata!.url!)}
                              className="flex items-center justify-center w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors gap-2"
                            >
                              <ExternalLink className="w-4 h-4" />
                              在浏览器中阅读原文
                            </button>
                          )}
                        </div>
                      )}

                      {/* File message */}
                      {selectedMessage.contentType === 'file' && (
                        <div className="space-y-4">
                          <div className="flex items-center p-4 rounded-lg bg-orange-50/50 border border-orange-100">
                            <div className="w-12 h-12 rounded-lg bg-orange-100 flex items-center justify-center mr-3 shrink-0">
                              <File className="w-6 h-6 text-orange-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-[#18181B] truncate">
                                {selectedMessage.metadata?.title || selectedMessage.content.replace('[文件]', '').trim() || '未知文件'}
                              </div>
                              {selectedMessage.metadata?.filePath && (
                                <p className="text-xs text-orange-500 mt-1 break-all">{selectedMessage.metadata.filePath}</p>
                              )}
                              <div className="text-xs text-[#A1A1AA] mt-0.5">{selectedMessage.metadata?.fileSize || '大小未知'}</div>
                            </div>
                          </div>
                          {/* Show full content */}
                          <div className="text-xs text-[#A1A1AA] bg-[#FAFAFA] p-3 rounded-lg max-h-[200px] overflow-y-auto break-all">
                            {selectedMessage.content}
                          </div>
                        </div>
                      )}

                      {/* Voice message */}
                      {selectedMessage.contentType === 'voice' && (
                        <div className="flex items-center p-4 rounded-lg bg-emerald-50 border border-emerald-100 gap-4">
                           <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white shrink-0 shadow-sm">
                              <RefreshCw className="w-5 h-5" />
                           </div>
                           <div className="flex-1">
                              <div className="h-1.5 w-full bg-emerald-200 rounded-full overflow-hidden">
                                 <div className="h-full bg-emerald-500 w-1/3 rounded-full"></div>
                              </div>
                              <div className="text-[10px] text-emerald-600 font-bold mt-2 uppercase tracking-tight">语音时长: {selectedMessage.metadata?.duration || 0}s</div>
                           </div>
                        </div>
                      )}

                      {/* Video message */}
                      {selectedMessage.contentType === 'video' && (
                        <div className="space-y-3">
                          <div className="aspect-video rounded-lg bg-black flex items-center justify-center border border-[#E4E4E7] shadow-inner relative overflow-hidden group">
                             <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                             <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white z-20 group-hover:scale-110 transition-transform">
                                <RefreshCw className="w-6 h-6" />
                             </div>
                             <div className="absolute bottom-3 left-3 text-white text-[10px] font-medium z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                               视频预览不可用
                             </div>
                          </div>
                          <p className="text-xs text-[#71717A] text-center">视频播放需连接原始数据库</p>
                        </div>
                      )}

                      {/* Text message */}
                      {selectedMessage.contentType === 'text' && (
                        <div className="text-sm text-[#18181B] leading-relaxed whitespace-pre-wrap break-words">
                          {selectedMessage.content || '(无内容)'}
                        </div>
                      )}

                      {/* URL open button for official_account type with URL */}
                      {selectedMessage.type === 'official_account' && selectedMessage.metadata?.url && selectedMessage.contentType !== 'article' && (
                        <div className="mt-4 pt-4 border-t border-[#F4F4F5]">
                           <button
                             onClick={() => handleOpenUrl(selectedMessage.metadata!.url!)}
                             className="flex items-center justify-center w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors gap-2"
                           >
                             阅读原文 <BookMarked className="w-4 h-4" />
                           </button>
                        </div>
                      )}
                    </div>
                    
                    {selectedMessage.metadata?.digest && selectedMessage.contentType !== 'article' && (
                      <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
                        <label className="text-[11px] font-bold text-blue-400 uppercase tracking-wider block mb-2">智能摘要</label>
                        <p className="text-sm text-blue-800 leading-relaxed italic">
                          {selectedMessage.metadata.digest}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-white border border-dashed border-[#E4E4E7] rounded-xl">
                    <PanelRight className="w-8 h-8 text-[#E4E4E7] mb-3" />
                    <p className="text-sm text-[#A1A1AA]">点击左侧列表中的消息查看详情</p>
                    <p className="text-[10px] text-[#D4D4D8] mt-1">链接、图片、文件、公众号文章可查看更多信息</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-8"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-full w-auto flex flex-col items-center gap-4">
             {!previewImage.startsWith('img:') ? (
               <img 
                 src={`/api/file?path=${encodeURIComponent(previewImage)}`}
                 alt="预览"
                 className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
                 onClick={(e) => e.stopPropagation()}
                 onError={(e) => {
                   const target = e.target as HTMLImageElement;
                   target.style.display = 'none';
                   const parent = target.parentElement;
                   if (parent) {
                     const errDiv = document.createElement('div');
                     errDiv.className = 'bg-[#1a1a2e] rounded-lg border border-amber-700/50 p-8 flex items-center justify-center min-h-[200px]';
                     errDiv.innerHTML = `<div class="text-center"><svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 text-amber-500/50 mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><p class="text-sm text-amber-300/80 font-medium">图片加载失败</p><p class="text-xs text-amber-400/50 mt-2 break-all max-w-md">${previewImage}</p><p class="text-xs text-gray-500 mt-2">请检查图片文件是否存在或加密方式是否变化</p></div>`;
                     parent.insertBefore(errDiv, target);
                   }
                 }}
               />
             ) : (
               <div className="bg-[#1a1a2e] rounded-lg border border-gray-700 p-8 flex items-center justify-center min-h-[200px]">
                 <div className="text-center">
                   <ImageIcon className="w-16 h-16 text-gray-600 mx-auto mb-3" />
                   <p className="text-sm text-gray-400">图片预览不可用</p>
                   <p className="text-xs text-gray-500 mt-1 break-all max-w-md">{previewImage}</p>
                 </div>
               </div>
             )}
             <Button variant="outline" className="text-white border-gray-600 bg-gray-800 hover:bg-gray-700" onClick={() => setPreviewImage(null)}>
               关闭预览
             </Button>
          </div>
        </div>
      )}
    </div>
  );
}
