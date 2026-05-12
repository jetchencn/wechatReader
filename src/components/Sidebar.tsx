import React, { useState } from 'react';
import { useAppStore } from '../store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Contact } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
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
  BookMarked
} from 'lucide-react';

export function Sidebar({ className = '' }: { className?: string }) {
  const { contacts, views, selectedContactId, selectedViewId, selectedContactType, selectContact, selectView, selectContactType, searchQuery, setSearchQuery, setShowWizard, setSettingsTab } = useAppStore();
  
  const [expandedSections, setExpandedSections] = useState({
    smart: true,
    person: true,
    group: true,
    official_account: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const subscribedContacts = contacts.filter(c => c.isSubscribed);
  
  const groupedContacts = {
    person: subscribedContacts.filter(c => c.type === 'person'),
    group: subscribedContacts.filter(c => c.type === 'group'),
    official_account: subscribedContacts.filter(c => c.type === 'official_account'),
  };

  const renderContactList = (items: Contact[], emptyText: string) => {
    if (items.length === 0) {
      return <div className="px-8 py-2 text-xs text-[#A1A1AA]">{emptyText}</div>;
    }
    
    return items.map(contact => (
      <div 
        key={contact.id}
        onClick={() => {
          selectContact(contact.id);
          setShowWizard(false);
        }}
        className={`flex items-center px-4 py-2 cursor-pointer group transition-colors ${
          selectedContactId === contact.id ? 'bg-[#F4F4F5] text-[#18181B] font-medium border-r-2 border-[#18181B]' : 'text-[#71717A] hover:bg-[#FAFAFA]'
        }`}
      >
        {contact.avatar ? (
          <img
            src={contact.avatar}
            alt={contact.name}
            className="w-6 h-6 rounded object-cover mr-3 shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div className={`w-6 h-6 rounded bg-[#E4E4E7] flex items-center justify-center text-xs font-bold mr-3 shrink-0 text-[#18181B] ${contact.avatar ? 'hidden' : ''}`}>
          {contact.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{contact.name}</p>
        </div>
        {contact.lastMessageTime && (
          <span className="text-[10px] text-[#A1A1AA] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pl-2">
            {formatDistanceToNow(contact.lastMessageTime, { locale: zhCN, addSuffix: true }).replace('前', '')}
          </span>
        )}
      </div>
    ));
  };

  return (
    <aside className={className || "w-64 bg-white border-r border-[#E4E4E7] flex flex-col"}>
      {/* Search */}
      <div className="p-4 border-b border-[#E4E4E7]" style={{ height: '69px' }}>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#A1A1AA]" />
          <Input 
            placeholder="全文搜索..." 
            className="pl-9 h-9 text-sm bg-[#F4F4F5] border-transparent focus-visible:ring-black focus-visible:bg-white rounded-lg transition-all"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <nav className="py-3 flex-1 space-y-1 overflow-y-auto">
          {/* Smart Views */}
          <div className="mb-4">
            <div 
              className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-wider px-4 mb-2 mt-2 flex items-center cursor-pointer hover:text-[#18181B] transition-colors"
              onClick={() => toggleSection('smart')}
            >
              {expandedSections.smart ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
              智能视图
            </div>
            {expandedSections.smart && (
              <div className="mt-1 space-y-0.5">
                {subscribedContacts.length === 0 ? (
                  <div className="px-8 py-2 text-xs text-[#A1A1AA]">暂无订阅，无法生成视图</div>
                ) : (
                  views.filter(v => v.id !== 4 && v.id !== 3).map(view => (
                    <div 
                      key={view.id}
                      onClick={() => {
                      selectView(view.id);
                      setShowWizard(false);
                    }}
                      className={`flex items-center px-4 py-2 cursor-pointer transition-colors ${
                        selectedViewId === view.id ? 'bg-[#F4F4F5] text-[#18181B] font-medium border-r-2 border-[#18181B]' : 'text-[#71717A] hover:bg-[#FAFAFA]'
                      }`}
                    >
                      <span className="mr-3 text-sm flex items-center justify-center text-[#52525B]">
                        {view.id === 1 && <Clock className="w-4 h-4" />}
                        {view.id === 2 && <CalendarDays className="w-4 h-4" />}
                        {view.id === 3 && <BookMarked className="w-4 h-4" />}
                      </span>
                      <span className="text-sm flex-1">{view.name}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="px-4 pb-2 pt-1">
            <div className="h-px bg-[#E4E4E7] w-full" />
          </div>

          {/* Directory */}
          <div className="space-y-4 pt-2">
            {/* Person */}
            <div>
              <div 
                className={`text-[10px] font-bold uppercase tracking-wider px-4 mb-2 flex items-center justify-between cursor-pointer transition-colors ${selectedContactType === 'person' ? 'text-[#18181B] bg-[#F4F4F5] py-1.5 rounded-md' : 'text-[#A1A1AA] hover:text-[#18181B]'}`}
                onClick={() => {
                  if (selectedContactType === 'person') {
                    selectContactType(null);
                  } else {
                    selectContactType('person');
                  }
                  setShowWizard(false);
                }}
              >
                <div className="flex items-center">
                  {expandedSections.person ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                  <Users className="w-3 h-3 mr-1" />
                  联系人
                </div>
                <span>{groupedContacts.person.length}</span>
              </div>
              {expandedSections.person && renderContactList(groupedContacts.person, '暂无订阅的联系人')}
            </div>

            {/* Groups */}
            <div>
              <div 
                className={`text-[10px] font-bold uppercase tracking-wider px-4 mb-2 mt-4 flex items-center justify-between cursor-pointer transition-colors ${selectedContactType === 'group' ? 'text-[#18181B] bg-[#F4F4F5] py-1.5 rounded-md' : 'text-[#A1A1AA] hover:text-[#18181B]'}`}
                onClick={() => {
                  if (selectedContactType === 'group') {
                    selectContactType(null);
                  } else {
                    selectContactType('group');
                  }
                  setShowWizard(false);
                }}
              >
                <div className="flex items-center">
                  {expandedSections.group ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                  <MessageSquare className="w-3 h-3 mr-1" />
                  微信群
                </div>
                <span>{groupedContacts.group.length}</span>
              </div>
              {expandedSections.group && renderContactList(groupedContacts.group, '暂无订阅的微信群')}
            </div>

            {/* Official Accounts */}
            <div>
              <div 
                className={`text-[10px] font-bold uppercase tracking-wider px-4 mb-2 mt-4 flex items-center justify-between cursor-pointer transition-colors ${selectedContactType === 'official_account' ? 'text-[#18181B] bg-[#F4F4F5] py-1.5 rounded-md' : 'text-[#A1A1AA] hover:text-[#18181B]'}`}
                onClick={() => {
                  if (selectedContactType === 'official_account') {
                    selectContactType(null);
                  } else {
                    selectContactType('official_account');
                  }
                  setShowWizard(false);
                }}
              >
                <div className="flex items-center">
                  {expandedSections.official_account ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                  <BookOpen className="w-3 h-3 mr-1" />
                  公众号
                </div>
                <span>{groupedContacts.official_account.length}</span>
              </div>
              {expandedSections.official_account && renderContactList(groupedContacts.official_account, '暂无订阅的公众号')}
            </div>
          </div>
        </nav>
      </ScrollArea>
      <div className="p-4 border-t border-[#E4E4E7] flex items-center justify-between">
        <button className="flex items-center gap-2 text-[#18181B] hover:opacity-80 transition-opacity">
          <div className="w-6 h-6 rounded-full bg-[#E4E4EB] flex items-center justify-center overflow-hidden">
            <svg className="w-6 h-6 text-white mt-1.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 20.993V24H0v-2.996A14.977 14.977 0 0112.004 15c4.904 0 9.26 2.354 11.996 5.993zM16.002 8.999a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <span className="text-sm">登录</span>
        </button>
        <button 
          className="flex items-center gap-1.5 text-[#18181B] hover:opacity-80 transition-opacity"
          onClick={() => {
            const hasSubs = contacts.some(c => c.isSubscribed);
            setSettingsTab(hasSubs ? 'general' : 'subs');
            setShowWizard(true);
          }}
        >
          <Settings className="w-4 h-4" />
          <span className="text-sm">设置</span>
        </button>
      </div>
    </aside>
  );
}
