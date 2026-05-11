import React, { useMemo } from 'react';
import { useAppStore } from '../store';
import { GlobalSearch } from './GlobalSearch';
import { FolderSync, User, Users, BookOpen } from 'lucide-react';
import { MessageTable } from './MessageTable';

export function ContentArea() {
  const { selectedContactId, selectedViewId, searchQuery, contacts, messages } = useAppStore();

  const filteredMessages = useMemo(() => {
    if (selectedContactId) {
      return messages.filter(m => m.contactId === selectedContactId);
    }
    return [];
  }, [selectedContactId, messages]);

  if (searchQuery) {
    return <GlobalSearch />;
  }

  if (selectedContactId) {
    const contact = contacts.find(c => c.id === selectedContactId);
    if (!contact) return <EmptyState />;
    
    const icon = contact.type === 'person' ? <User className="w-5 h-5" /> : 
                 contact.type === 'group' ? <Users className="w-5 h-5" /> : 
                 <BookOpen className="w-5 h-5" />;
                 
    return (
      <MessageTable 
        key={`contact-${selectedContactId}`}
        messages={filteredMessages}
        title={contact.name}
        icon={icon}
        searchPlaceholder={`在 "${contact.name}" 中搜索...`}
      />
    );
  }

  if (selectedViewId) {
    return <GlobalSearch overrideViewId={selectedViewId} />;
  }

  return <EmptyState />;
}

function EmptyState() {
  const { isInitialized, setShowWizard, contacts } = useAppStore();
  const hasSubscriptions = contacts.some(c => c.isSubscribed);

  return (
    <div className="flex flex-col items-center justify-center h-full text-[#A1A1AA] bg-[#F9F9FB]">
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
              onClick={() => setShowWizard(true)}
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
            onClick={() => setShowWizard(true)}
            className="px-6 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-[#27272A] transition-colors"
          >
            开始配置
          </button>
        </div>
      )}
    </div>
  );
}
