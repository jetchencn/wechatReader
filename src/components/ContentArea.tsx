import React from 'react';
import { useAppStore } from '../store';
import { ChatView } from './ChatView';
import { ArticleView } from './ArticleView';
import { GlobalSearch } from './GlobalSearch';
import { FolderSync } from 'lucide-react';

export function ContentArea() {
  const { selectedContactId, selectedViewId, searchQuery, contacts } = useAppStore();

  if (searchQuery) {
    return <GlobalSearch />;
  }

  if (selectedContactId) {
    const contact = contacts.find(c => c.id === selectedContactId);
    if (!contact) return <EmptyState />;
    
    if (contact.type === 'official_account') {
      return <ArticleView contact={contact} />;
    }
    
    return <ChatView contact={contact} />;
  }

  if (selectedViewId) {
    return <GlobalSearch overrideViewId={selectedViewId} />;
  }

  return <EmptyState />;
}

function EmptyState() {
  const { isInitialized, setShowWizard } = useAppStore();

  return (
    <div className="flex flex-col items-center justify-center h-full text-[#A1A1AA] bg-[#F9F9FB]">
      <div className="w-24 h-24 bg-[#F4F4F5] rounded-2xl border border-dashed border-[#D4D4D8] flex items-center justify-center mb-6">
        <FolderSync className="w-10 h-10 text-[#A1A1AA]" />
      </div>
      <h2 className="text-xl font-bold text-[#18181B] mb-2 italic tracking-tight">Wichat Reader</h2>
      {isInitialized ? (
        <p className="text-sm font-medium">在左侧选择数据源，开启沉浸式查阅</p>
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
