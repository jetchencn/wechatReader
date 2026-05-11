import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { FileText, Search, SearchX, Download, Clock, CalendarDays, BookMarked, Paperclip, Filter, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../store';
import { WeChatMessage } from '../types';
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

interface MessageTableProps {
  messages: WeChatMessage[];
  title: string | React.ReactNode;
  icon?: React.ReactNode;
  searchPlaceholder?: string;
  showFilters?: boolean;
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

export function MessageTable({ messages, title, icon, searchPlaceholder, showFilters = true }: MessageTableProps) {
  const { contacts } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [selectedContentTypes, setSelectedContentTypes] = useState<Set<string>>(new Set());
  const [selectedSenders, setSelectedSenders] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const getContactName = (contactId: string) => {
    return contacts.find(c => c.id === contactId)?.name || '未知来源';
  };

  const { results, filterOptions, totalCount, unreadCount } = useMemo(() => {
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

    const totalCount = filtered.length;
    const unreadCount = filtered.filter(m => !m.isRead).length;

    if (showUnreadOnly) {
      filtered = filtered.filter(m => !m.isRead);
    }

    return {
      results: filtered.sort((a, b) => b.timestamp - a.timestamp),
      filterOptions: {
        contacts: Array.from(contactsSet).sort(),
        contentTypes: Array.from(contentTypesSet).sort(),
        senders: Array.from(sendersSet).filter(Boolean).sort(),
        groups: Array.from(groupsSet).sort(),
      },
      totalCount,
      unreadCount
    };
  }, [messages, searchQuery, contacts, selectedContacts, selectedContentTypes, selectedSenders, selectedGroups, showUnreadOnly]);

  const toggleFilter = (set: Set<string>, value: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    const next = new Set(set);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    setter(next);
  };

  const handleExportCSV = () => {
    const headers = ['时间', '会话', '类型', '发信人', '内容', '归属', '链接', '状态'];
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
      msg.metadata?.url || '',
      !msg.isRead ? '未读' : '已读'
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
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 py-4 bg-white border-b border-[#E4E4E7] z-10 shrink-0 flex items-center justify-between" style={{ height: '69px' }}>
        <div className="flex items-center">
          <h2 className="text-xl font-semibold tracking-tight text-[#18181B] flex items-center">
            {icon && <span className="mr-3 text-[#71717A] flex items-center justify-center">{icon}</span>}
            {title}
          </h2>
          <div className="flex items-center gap-2 ml-4 text-[10px] font-bold uppercase tracking-wider">
             <button 
               onClick={() => setShowUnreadOnly(false)}
               className={`flex items-center transition-colors ${!showUnreadOnly ? 'text-[#18181B]' : 'text-[#A1A1AA] hover:text-[#18181B]'}`}
             >
                <span className={!showUnreadOnly ? 'bg-[#F4F4F5] px-2 py-0.5 rounded-full' : 'px-2 py-0.5'}>
                  {totalCount} 条记录
                </span>
             </button>
             <span className="text-[#E4E4E7]">/</span>
             <button 
               onClick={() => setShowUnreadOnly(true)}
               className={`flex items-center transition-colors ${showUnreadOnly ? 'text-blue-600' : 'text-[#A1A1AA] hover:text-blue-600'}`}
             >
                <span className={showUnreadOnly ? 'bg-blue-50 px-2 py-0.5 rounded-full text-blue-600' : 'px-2 py-0.5'}>
                  {unreadCount} 条未读
                </span>
             </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full">
          <div className="sticky top-0 z-20 bg-white p-3 flex items-center justify-between border-b border-[#E4E4E7]">
            <div className="relative w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#A1A1AA]" />
              <Input 
                placeholder={searchPlaceholder || "搜索归档记录..."}
                className="pl-9 h-9 text-sm bg-white border border-[#E4E4E7] ring-0 focus-visible:ring-0 focus-visible:border-black rounded-none transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button onClick={handleExportCSV} variant="outline" size="sm" className="hidden sm:flex border border-[#E4E4E7] rounded-none hover:bg-[#F4F4F5] text-[#18181B] bg-white h-9 text-xs">
              <Download className="w-3 h-3 mr-1.5" />
              导出
            </Button>
          </div>

          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#A1A1AA] space-y-4">
              <div className="w-16 h-16 bg-[#F4F4F5] rounded-xl border border-dashed border-[#D4D4D8] flex items-center justify-center">
                <SearchX className="w-8 h-8 text-[#A1A1AA]" />
              </div>
              <p className="text-sm font-medium">没有匹配的归档记录</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-[#F4F4F5] text-[#71717A] text-xs uppercase font-semibold border-b border-[#E4E4E7] sticky top-[60px] z-10 transition-all">
                <tr>
                  <th className="px-6 py-3 font-medium">时间</th>
                  <th className="px-6 py-3 font-medium">
                    <FilterMenu 
                      title="会话" 
                      options={filterOptions.contacts} 
                      selected={selectedContacts} 
                      onToggle={(c) => toggleFilter(selectedContacts, c, setSelectedContacts)} 
                    />
                  </th>
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
                  <th className="px-6 py-3 font-medium">
                    <FilterMenu 
                      title="归属" 
                      options={filterOptions.groups} 
                      selected={selectedGroups} 
                      onToggle={(g) => toggleFilter(selectedGroups, g, setSelectedGroups)} 
                    />
                  </th>
                  <th className="px-6 py-3 font-medium">链接</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7] bg-white">
                {results.map((msg) => (
                  <tr key={msg.id} className={`hover:bg-[#F4F4F5] transition-colors cursor-pointer group`}>
                    <td className="px-6 py-4 text-xs whitespace-nowrap font-mono">
                      {!msg.isRead && (
                        <span className="font-bold text-blue-500 mr-1 text-base leading-none relative top-[-1px]">.</span>
                      )}
                      <span className={!msg.isRead ? 'text-[#18181B] font-bold' : 'text-[#A1A1AA]'}>
                        {format(msg.timestamp, 'HH:mm:ss')}
                      </span>
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap ${!msg.isRead ? 'font-bold text-[#18181B]' : 'font-medium text-[#18181B]'}`}>
                      {getContactName(msg.contactId)}
                    </td>
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
                    <td className="px-6 py-4 text-[#52525B] max-w-[300px] truncate group-hover:text-black transition-colors" title={msg.content}>
                      {msg.contentType === 'file' ? (
                        <div className="flex items-center text-[#18181B] font-medium"><FileText className="w-4 h-4 mr-1.5 text-[#A1A1AA]"/> {msg.content}</div>
                      ) : msg.contentType === 'image' ? (
                        <span className="text-[#A1A1AA]">[图片]</span>
                      ) : msg.contentType === 'voice' ? (
                        <span className="text-[#A1A1AA]">[声音时长: {msg.metadata?.duration || 0}s]</span>
                      ) : (
                        <span className={!msg.isRead ? 'font-medium text-[#18181B]' : ''}>{msg.content}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-[#52525B] whitespace-nowrap">
                      {msg.type === 'person' ? '联系人' : msg.type === 'group' ? '微信群' : '公众号'}
                    </td>
                    <td className="px-6 py-4 text-blue-600 hover:text-blue-800 whitespace-nowrap truncate max-w-[150px]">
                      {msg.type === 'official_account' && msg.metadata?.url ? (
                        <a href={msg.metadata.url} target="_blank" rel="noopener noreferrer" className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          查看文章
                        </a>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
