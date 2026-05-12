import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, SearchX, FolderSync, User, Users, MessageSquare, CheckCircle2, ArrowRight, ArrowLeft, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Contact } from '../types';

interface SubscriptionSettingsProps {
  onNavigateToInit?: () => void;
}

interface ApiContact {
  id: string;
  username: string;
  name: string;
  nick_name: string;
  remark: string;
  avatar: string;
  type: 'person' | 'group' | 'official_account';
}

export function SubscriptionSettings({ onNavigateToInit }: SubscriptionSettingsProps) {
  const { setSubscribedContacts, setContacts, isInitialized } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');

  // All contacts from CLI
  const [allContacts, setAllContacts] = useState<ApiContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pending subscription IDs
  const [pendingSubscriptionIds, setPendingSubscriptionIds] = useState<string[]>([]);
  const [savedSubscriptionIds, setSavedSubscriptionIds] = useState<string[]>([]);

  const [isApplying, setIsApplying] = useState(false);

  // Collapse state for each category
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  // Load contacts from server API
  useEffect(() => {
    if (!isInitialized) {
      setIsLoading(false);
      return;
    }

    async function fetchData() {
      try {
        setIsLoading(true);
        setLoadError(null);

        // Fetch contacts from CLI
        const contactsRes = await fetch('/api/contacts?limit=5000');
        const contactsJson = await contactsRes.json();

        if (!contactsJson.ok) {
          setLoadError(contactsJson.error || 'Failed to load contacts');
          return;
        }

        const contacts: ApiContact[] = contactsJson.data;
        setAllContacts(contacts);

        // Fetch saved subscription IDs
        const subsRes = await fetch('/api/subscription-ids');
        const subsJson = await subsRes.json();
        if (subsJson.ok && Array.isArray(subsJson.data)) {
          setSavedSubscriptionIds(subsJson.data);
          setPendingSubscriptionIds(subsJson.data);
        }
      } catch (err) {
        setLoadError(String(err));
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [isInitialized]);

  // Filter contacts by search
  const filteredContacts = allContacts.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.nick_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.remark.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const unselectedContacts = filteredContacts.filter(c => !pendingSubscriptionIds.includes(c.id));
  const selectedContacts = allContacts
    .filter(c => pendingSubscriptionIds.includes(c.id))
    .filter(c =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.nick_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.remark.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const handleToggleContact = (id: string) => {
    setPendingSubscriptionIds(prev =>
      prev.includes(id) ? prev.filter(cid => cid !== id) : [...prev, id]
    );
  };

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      // Save to server SQLite
      const contactsToSave = allContacts
        .filter(c => pendingSubscriptionIds.includes(c.id))
        .map(c => ({ id: c.id, username: c.username, name: c.name, type: c.type }));

      await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: contactsToSave }),
      });

      setSavedSubscriptionIds(pendingSubscriptionIds);

      // Push real contacts into store so they appear in sidebar
      const storeContacts: Contact[] = allContacts
        .filter(c => pendingSubscriptionIds.includes(c.id))
        .map(c => ({
          id: c.id,
          type: c.type,
          name: c.name,
          avatar: c.avatar || undefined,
          isSubscribed: true,
        }));
      setContacts(storeContacts);
      setSubscribedContacts(pendingSubscriptionIds);

      setTimeout(() => {
        setIsApplying(false);
      }, 600);
    } catch (err) {
      console.error('Failed to save subscriptions:', err);
      setIsApplying(false);
    }
  };

  const isChanged = JSON.stringify([...pendingSubscriptionIds].sort()) !== JSON.stringify([...savedSubscriptionIds].sort());
  const subscribedCount = pendingSubscriptionIds.length;

  // Avatar component
  const AvatarImg = ({ contact }: { contact: ApiContact }) => {
    if (contact.avatar) {
      return (
        <img
          src={contact.avatar}
          alt={contact.name}
          className="w-6 h-6 rounded object-cover shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
            (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
          }}
        />
      );
    }
    return (
      <div className="w-6 h-6 rounded bg-[#F4F4F5] flex items-center justify-center text-[#18181B] font-bold shrink-0 text-[10px]">
        {contact.name.charAt(0)}
      </div>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full flex flex-col pt-2 overflow-hidden">
        <div className="pb-6 mb-6 flex items-center justify-between border-b border-[#F4F4F5] shrink-0">
          <div>
            <h3 className="text-xl font-bold text-[#18181B] flex items-center gap-2 mb-1">
              <FolderSync className="w-5 h-5 text-[#52525B]" />
              订阅
            </h3>
            <p className="text-sm text-[#71717A]">管理要在应用中显示的聊天和公众号</p>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-10 h-10 text-[#A1A1AA] animate-spin mb-4" />
          <p className="text-sm text-[#71717A]">正在从微信本地数据库加载联系人...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="h-full flex flex-col pt-2 overflow-hidden">
        <div className="pb-6 mb-6 flex items-center justify-between border-b border-[#F4F4F5] shrink-0">
          <div>
            <h3 className="text-xl font-bold text-[#18181B] flex items-center gap-2 mb-1">
              <FolderSync className="w-5 h-5 text-[#52525B]" />
              订阅
            </h3>
            <p className="text-sm text-[#71717A]">管理要在应用中显示的聊天和公众号</p>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-10">
          <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mb-6 border border-red-200">
            <SearchX className="w-10 h-10 text-red-400" />
          </div>
          <h4 className="text-xl font-bold text-[#18181B] mb-3">加载联系人失败</h4>
          <p className="text-sm text-[#71717A] max-w-sm mb-4 leading-relaxed">{loadError}</p>
          <Button
            onClick={() => window.location.reload()}
            className="bg-black text-white hover:bg-[#27272A] rounded-xl px-6 h-10 shadow-md font-bold"
          >
            重试
          </Button>
        </div>
      </div>
    );
  }

  const renderCategorizedList = (listContacts: ApiContact[], isSelectedList: boolean) => {
    const persons = listContacts.filter(c => c.type === 'person');
    const groups = listContacts.filter(c => c.type === 'group');
    const officials = listContacts.filter(c => c.type === 'official_account');

    if (listContacts.length === 0) {
      return (
        <div className="py-20 text-center flex flex-col items-center">
          <SearchX className="w-10 h-10 text-[#E4E4E7] mb-2" />
          <span className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-widest">无匹配结果</span>
        </div>
      );
    }

    const renderGroup = (title: string, items: ApiContact[], icon: React.ReactNode, sectionKey: string) => {
      if (items.length === 0) return null;
      const isCollapsed = collapsedSections[`${isSelectedList ? 'sel' : 'unsel'}-${sectionKey}`] ?? false;
      return (
        <div className="mb-2">
          <button
            className="flex items-center gap-2 mb-1 sticky top-0 bg-white/90 backdrop-blur-sm p-1 z-10 -mx-1 rounded-sm w-full text-left hover:bg-[#F4F4F5] transition-colors cursor-pointer"
            onClick={() => toggleSection(`${isSelectedList ? 'sel' : 'unsel'}-${sectionKey}`)}
          >
            <div className="p-1 bg-[#F4F4F5] rounded-md">
              {icon}
            </div>
            <h4 className="text-[10px] font-bold text-[#71717A] uppercase tracking-wider flex-1">{title} ({items.length})</h4>
            {isCollapsed ? <ChevronRight className="w-3 h-3 text-[#A1A1AA]" /> : <ChevronDown className="w-3 h-3 text-[#A1A1AA]" />}
          </button>
          {!isCollapsed && (
            <div className="flex flex-col gap-1.5 pb-2">
              {items.map(contact => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border bg-white border-[#E4E4E7] hover:border-black shadow-sm group"
                  onClick={() => handleToggleContact(contact.id)}
                >
                  <div className="flex items-center space-x-2.5 overflow-hidden">
                    <AvatarImg contact={contact} />
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-[#18181B] truncate">{contact.name}</p>
                      {contact.remark && contact.name !== contact.remark && (
                        <p className="text-[9px] text-[#A1A1AA] truncate">备注: {contact.remark}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-[#A1A1AA] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                    {isSelectedList ? (
                      <ArrowLeft className="w-3.5 h-3.5" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="py-1">
        {renderGroup('个人联系人', persons, <User className="w-3 h-3 text-blue-500" />, 'person')}
        {renderGroup('微信群组', groups, <Users className="w-3 h-3 text-purple-500" />, 'group')}
        {renderGroup('公众号 / 号主', officials, <MessageSquare className="w-3 h-3 text-orange-500" />, 'official')}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col pt-2 overflow-hidden">
      <div className="pb-6 mb-6 flex items-center justify-between border-b border-[#F4F4F5] shrink-0">
        <div>
          <h3 className="text-xl font-bold text-[#18181B] flex items-center gap-2 mb-1">
            <FolderSync className="w-5 h-5 text-[#52525B]" />
            订阅
          </h3>
          <p className="text-sm text-[#71717A]">管理要在应用中显示的聊天和公众号</p>
        </div>
        <div className="px-3 py-1 bg-[#F4F4F5] text-[#18181B] rounded-lg text-[10px] font-bold uppercase tracking-wider border border-[#E4E4E7]">
          总订阅 {subscribedCount}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* Top actions bar */}
        <div className="flex items-center gap-3 mb-4 shrink-0">
          <div className="w-80 relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#A1A1AA]" />
            <Input
              placeholder="搜索名称..."
              className="pl-9 h-9 text-sm bg-white border border-[#E4E4E7] ring-0 focus-visible:ring-0 focus-visible:border-black rounded-none transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button
            onClick={handleApply}
            disabled={(!isChanged && !isApplying) || isApplying}
            className={`h-9 px-6 text-sm rounded-none transition-all ${
              isApplying
                ? 'bg-green-500 text-white shadow-sm'
                : isChanged
                  ? 'bg-black text-white hover:bg-[#27272A] shadow-sm'
                  : 'bg-white text-[#A1A1AA] cursor-not-allowed border border-[#E4E4E7] hover:bg-white'
            }`}
          >
            {isApplying ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                已应用
              </>
            ) : '应用更改'}
          </Button>
        </div>

        {/* Dual columns */}
        <div className="flex-1 flex gap-4 min-h-0 overflow-hidden pb-4">
          {/* Unselected Column */}
          <div className="flex-1 flex flex-col min-h-0 bg-[#F9F9FB] border border-[#E4E4E7] rounded-lg p-3">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h4 className="text-xs font-bold text-[#18181B]">未选择</h4>
              <span className="text-[10px] font-bold text-[#A1A1AA] bg-white px-2 py-0.5 rounded border border-[#E4E4E7]">
                {unselectedContacts.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 min-h-0">
              {renderCategorizedList(unselectedContacts, false)}
            </div>
          </div>

          {/* Selected Column */}
          <div className="flex-1 flex flex-col min-h-0 bg-[#F4F4F5] border border-[#E4E4E7] rounded-lg p-3">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h4 className="text-xs font-bold text-[#18181B]">已选择</h4>
              <span className="text-[10px] font-bold text-[#A1A1AA] bg-white px-2 py-0.5 rounded border border-[#E4E4E7]">
                {selectedContacts.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 min-h-0">
              {renderCategorizedList(selectedContacts, true)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}