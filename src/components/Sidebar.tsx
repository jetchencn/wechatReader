import React, { useState, useMemo } from 'react';
import { useAppStore } from '../store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Contact } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { prefetchContactMessages } from './ContentArea';
import { 
  Search, 
  FolderSync, 
  Users, 
  BookOpen, 
  MessageSquare,
  ChevronRight,
  ChevronDown,
  LogIn,
  Settings,
  Clock,
  CalendarDays,
  BookMarked,
  PanelLeftClose,
  PanelLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function Sidebar({ className = '', onToggleCollapse, isCollapsed }: { className?: string, onToggleCollapse?: () => void, isCollapsed?: boolean }) {
  const { contacts, views, selectedContactId, selectedViewId, selectedContactType, selectContact, selectView, selectContactType, searchQuery, setSearchQuery, setShowWizard, setSettingsTab } = useAppStore();
  
  const [expandedSections, setExpandedSections] = useState({
    smart: true,
    person: true,
    group: true,
    official_account: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    if (isCollapsed) return;
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const subscribedContacts = useMemo(() => contacts.filter(c => c.isSubscribed), [contacts]);
  
  const groupedContacts = useMemo(() => ({
    person: subscribedContacts.filter(c => c.type === 'person'),
    group: subscribedContacts.filter(c => c.type === 'group'),
    official_account: subscribedContacts.filter(c => c.type === 'official_account'),
  }), [subscribedContacts]);

  const renderContactList = (items: Contact[], emptyText: string) => {
    if (!isCollapsed && items.length === 0) {
      return <div className="px-8 py-2 text-xs text-[#A1A1AA]">{emptyText}</div>;
    }
    
    return items.map(contact => (
      <Tooltip key={contact.id}>
        <TooltipTrigger className="w-full block p-0 bg-transparent border-none text-left focus:outline-none">
          <div 
            onClick={() => {
              selectContact(contact.id);
              setShowWizard(false);
            }}
            onMouseEnter={() => prefetchContactMessages(contact.id)}
            className={cn(
              "flex items-center cursor-pointer group transition-all w-full",
              isCollapsed ? "px-4 py-2 mx-0 my-0.5 rounded-lg" : "px-4 py-2",
              selectedContactId === contact.id 
                ? (isCollapsed ? 'bg-black text-white shadow-sm' : 'bg-[#F4F4F5] text-[#18181B] font-medium border-r-2 border-[#18181B]') 
                : 'text-[#71717A] hover:bg-[#FAFAFA]'
            )}
          >
            {contact.avatar ? (
              <img
                src={contact.avatar}
                alt={contact.name}
                className={cn("rounded object-cover shrink-0", isCollapsed ? "w-5 h-5" : "w-6 h-6 mr-3")}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : (
              <div className={cn(
                "rounded flex items-center justify-center text-xs font-bold shrink-0",
                isCollapsed ? "w-8 h-8 text-[14px]" : "w-6 h-6 mr-3 bg-[#E4E4E7] text-[#18181B]"
              )}
              style={isCollapsed && selectedContactId !== contact.id ? { backgroundColor: '#E4E4E7', color: '#18181B' } : {}}
              >
                {contact.name.charAt(0)}
              </div>
            )}
            {!isCollapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm truncate text-left">{contact.name}</p>
                </div>
                {contact.lastMessageTime && (
                  <span className="text-[10px] text-[#A1A1AA] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pl-2">
                    {formatDistanceToNow(contact.lastMessageTime, { locale: zhCN, addSuffix: true }).replace('前', '')}
                  </span>
                )}
              </>
            )}
          </div>
        </TooltipTrigger>
      </Tooltip>
    ));
  };

  return (
    <aside className={cn(
      className || "bg-white border-r border-[#E4E4E7] flex flex-col transition-all duration-300",
      isCollapsed ? "w-[64px]" : "w-[217px]"
    )}>
      {/* Search / Toggle Area */}
      <div className={cn(
        "px-4 py-4 border-b border-[#E4E4E7] flex items-center gap-2",
        isCollapsed ? "p-0 pl-5 h-[69px]" : "h-[69px]"
      )}>
        {!isCollapsed ? (
          <>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#A1A1AA]" />
              <Input 
                placeholder="全文搜索..." 
                className="pl-9 h-9 text-sm bg-[#F4F4F5] border-transparent focus-visible:ring-black focus-visible:bg-white rounded-lg transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {onToggleCollapse && (
              <button 
                onClick={onToggleCollapse}
                className="p-1.5 rounded-md hover:bg-[#F4F4F5] text-[#71717A] hover:text-[#18181B] transition-colors"
                title="收起侧边栏"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )}
          </>
        ) : (
          <button 
            onClick={onToggleCollapse}
            className="p-2 rounded-md hover:bg-[#F4F4F5] text-[#71717A] hover:text-[#18181B] transition-colors"
            title="展开侧边栏"
          >
            <PanelLeft className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Smart Views - 不滚动区域 */}
      <div className={cn("flex-none", isCollapsed ? "py-1" : "py-3")}>
        <div className={cn(!isCollapsed ? "mb-2" : "mb-1")}>
          {!isCollapsed && (
            <div 
              className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-wider px-4 mb-2 mt-2 flex items-center cursor-pointer hover:text-[#18181B] transition-colors"
              onClick={() => toggleSection('smart')}
            >
              {expandedSections.smart ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
              智能视图
            </div>
          )}
          {(expandedSections.smart || isCollapsed) && (
            <div className={cn("flex flex-col space-y-0.5", isCollapsed ? "px-2" : "mt-1")}>
              {!isCollapsed && subscribedContacts.length === 0 ? (
                <div className="px-8 py-2 text-xs text-[#A1A1AA]">暂无订阅，无法生成视图</div>
              ) : (
                views.filter(v => v.id !== 4 && v.id !== 3).map(view => (
                  <Tooltip key={view.id}>
                    <TooltipTrigger className="w-full block p-0 bg-transparent border-none text-left focus:outline-none">
                      <div 
                        onClick={() => {
                          selectView(view.id);
                          setShowWizard(false);
                        }}
                        className={cn(
                          "flex items-center cursor-pointer transition-all w-full text-left",
                          isCollapsed ? "p-2 pl-4 rounded-lg" : "px-4 py-2",
                          selectedViewId === view.id 
                            ? (isCollapsed ? 'bg-black text-white shadow-sm' : 'bg-[#F4F4F5] text-[#18181B] font-medium border-r-2 border-[#18181B]') 
                            : 'text-[#71717A] hover:bg-[#FAFAFA]'
                        )}
                      >
                        <span className={cn("text-sm flex items-center justify-center shrink-0", !isCollapsed ? "mr-3 text-[#52525B]" : "")}>
                          {view.id === 1 && <Clock className={isCollapsed ? "w-5 h-5" : "w-4 h-4"} />}
                          {view.id === 2 && <CalendarDays className={isCollapsed ? "w-5 h-5" : "w-4 h-4"} />}
                          {view.id === 3 && <BookMarked className={isCollapsed ? "w-5 h-5" : "w-4 h-4"} />}
                        </span>
                        {!isCollapsed && <span className="text-sm flex-1 text-left">{view.name}</span>}
                      </div>
                    </TooltipTrigger>
                  </Tooltip>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-2 pt-1">
        <div className="h-px bg-[#E4E4E7] w-full" />
      </div>

      {/* 联系人/微信群/公众号 - 可滚动区域 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <nav className={cn("pt-2 pb-4 w-full", isCollapsed ? "space-y-2 px-2" : "space-y-4")}>
          <div className={cn(isCollapsed ? "space-y-2" : "space-y-4")}>
            {/* Person */}
            <div>
              {!isCollapsed && (
                <div 
                  className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-wider px-4 mb-2 flex items-center justify-between cursor-pointer hover:text-[#18181B] transition-colors"
                  onClick={() => toggleSection('person')}
                >
                  <div className="flex items-center">
                    {expandedSections.person ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                    <Users className="w-3 h-3 mr-1" />
                    联系人
                  </div>
                  <span>{groupedContacts.person.length}</span>
                </div>
              )}
              {(expandedSections.person || isCollapsed) && renderContactList(groupedContacts.person, '暂无订阅的联系人')}
            </div>

            {/* Groups */}
            <div>
              {!isCollapsed && (
                <div 
                  className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-wider px-4 mb-2 mt-4 flex items-center justify-between cursor-pointer hover:text-[#18181B] transition-colors"
                  onClick={() => toggleSection('group')}
                >
                  <div className="flex items-center">
                    {expandedSections.group ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                    <MessageSquare className="w-3 h-3 mr-1" />
                    微信群
                  </div>
                  <span>{groupedContacts.group.length}</span>
                </div>
              )}
              {(expandedSections.group || isCollapsed) && renderContactList(groupedContacts.group, '暂无订阅的微信群')}
            </div>

            {/* Official Accounts */}
            <div>
              {!isCollapsed && (
                <div 
                  className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-wider px-4 mb-2 mt-4 flex items-center justify-between cursor-pointer hover:text-[#18181B] transition-colors"
                  onClick={() => toggleSection('official_account')}
                >
                  <div className="flex items-center">
                    {expandedSections.official_account ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                    <BookOpen className="w-3 h-3 mr-1" />
                    公众号
                  </div>
                  <span>{groupedContacts.official_account.length}</span>
                </div>
              )}
              {(expandedSections.official_account || isCollapsed) && renderContactList(groupedContacts.official_account, '暂无订阅的公众号')}
            </div>
          </div>
        </nav>
      </div>

      <div className={cn("p-4 border-t border-[#E4E4E7] flex", isCollapsed ? "flex-col items-start gap-4" : "items-center justify-between")}>
        <Tooltip>
          <TooltipTrigger className="block p-0 bg-transparent border-none text-left focus:outline-none">
            <div 
              role="button"
              tabIndex={0}
              className="flex items-center gap-2 text-[#18181B] hover:opacity-80 transition-opacity cursor-pointer"
            >
              <div className="w-6 h-6 rounded-full bg-[#E4E4EB] flex items-center justify-center overflow-hidden">
                <svg className="w-6 h-6 text-white mt-1.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 20.993V24H0v-2.996A14.977 14.977 0 0112.004 15c4.904 0 9.26 2.354 11.996 5.993zM16.002 8.999a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              {!isCollapsed && <span className="text-sm">登录</span>}
            </div>
          </TooltipTrigger>
        </Tooltip>
        
        <Tooltip>
          <TooltipTrigger className="block p-0 bg-transparent border-none text-left focus:outline-none">
            <div 
              role="button"
              tabIndex={0}
              onClick={() => {
                const hasSubs = contacts.some(c => c.isSubscribed);
                setSettingsTab(hasSubs ? 'general' : 'subs');
                setShowWizard(true);
              }}
              className="flex items-center gap-1.5 text-[#18181B] hover:opacity-80 transition-opacity cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              {!isCollapsed && <span className="text-sm">设置</span>}
            </div>
          </TooltipTrigger>
        </Tooltip>
      </div>
    </aside>
  );
}
