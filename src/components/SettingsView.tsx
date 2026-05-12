import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { InitializationWizard } from './InitializationWizard';
import { Database, Settings, FolderSync, X, Cog, FolderOpen, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SubscriptionSettings } from './SubscriptionSettings';
import { openDirectoryDialog } from '../lib/tauri';

const LS_MAX_QUERY_LIMIT = 'wechat-reader:config:maxQueryLimit';
const DEFAULT_MAX_QUERY_LIMIT = 5000;
const MAX_ALLOWED_LIMIT = 10000;

export function getMaxQueryLimit(): number {
  try {
    const saved = localStorage.getItem(LS_MAX_QUERY_LIMIT);
    if (saved) {
      const val = parseInt(saved, 10);
      if (!isNaN(val) && val > 0 && val <= MAX_ALLOWED_LIMIT) return val;
    }
  } catch { /* ignore */ }
  return DEFAULT_MAX_QUERY_LIMIT;
}

export function SettingsView() {
  const { isInitialized, setShowWizard, contacts, settingsTab } = useAppStore();
  const [activeTab, setActiveTab] = useState(settingsTab || (isInitialized ? 'general' : 'db'));

  // Local article directory state
  const [localArticleDir, setLocalArticleDir] = useState('');
  const [maxQueryLimit, setMaxQueryLimit] = useState(DEFAULT_MAX_QUERY_LIMIT);
  const [generalSaved, setGeneralSaved] = useState(false);

  // Load saved local article dir on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wechat-reader:config:localArticleDir');
      if (saved) setLocalArticleDir(saved);
    } catch { /* ignore */ }
  }, []);

  // Load saved max query limit on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_MAX_QUERY_LIMIT);
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val > 0 && val <= MAX_ALLOWED_LIMIT) setMaxQueryLimit(val);
      }
    } catch { /* ignore */ }
  }, []);

  const handleSaveLocalDir = () => {
    try {
      localStorage.setItem('wechat-reader:config:localArticleDir', localArticleDir);
      setDirSaved(true);
      setTimeout(() => setDirSaved(false), 2000);
    } catch { /* ignore */ }
  };

  const handleChooseDir = async () => {
    try {
      const dir = await openDirectoryDialog('选择本地文章目录');
      if (dir) {
        setLocalArticleDir(dir);
      }
    } catch { /* ignore */ }
  };

  const handleUpdateGeneral = () => {
    try {
      localStorage.setItem('wechat-reader:config:localArticleDir', localArticleDir);
      const val = Math.min(Math.max(1, maxQueryLimit), MAX_ALLOWED_LIMIT);
      localStorage.setItem(LS_MAX_QUERY_LIMIT, String(val));
      setMaxQueryLimit(val);
      setGeneralSaved(true);
      setTimeout(() => setGeneralSaved(false), 3000);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex h-full bg-white z-10 w-full overflow-hidden relative">
      {/* Close Button */}
      <button 
        onClick={() => setShowWizard(false)}
        className="absolute top-4 right-4 z-20 p-2 text-[#71717A] hover:text-[#18181B] hover:bg-[#F4F4F5] rounded-full transition-colors"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Settings Sidebar */}
      <div className="w-56 border-r border-[#E4E4E7] bg-[#F9F9FB] flex flex-col shrink-0">
        <div className="p-4 border-b border-[#E4E4E7] flex items-center justify-between">
          <h2 className="font-semibold text-[#18181B] flex items-center gap-2">
            <Settings className="w-4 h-4" />
            系统配置
          </h2>
        </div>
        <div className="p-3 flex-1 flex flex-col gap-1.5 overflow-auto">
          <button 
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'general' ? 'bg-[#E4E4E7] text-black shadow-sm' : 'text-[#71717A] hover:bg-[#F4F4F5]'}`}
          >
            <Cog className="w-4 h-4" />
            通用
          </button>
          <button 
            onClick={() => setActiveTab('subs')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'subs' ? 'bg-[#E4E4E7] text-black shadow-sm' : 'text-[#71717A] hover:bg-[#F4F4F5]'}`}
          >
            <FolderSync className="w-4 h-4" />
            订阅
          </button>
          <button 
            onClick={() => setActiveTab('db')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mt-auto ${activeTab === 'db' ? 'bg-[#E4E4E7] text-black shadow-sm' : 'text-[#71717A] hover:bg-[#F4F4F5]'}`}
          >
            <Database className="w-4 h-4" />
            初始化
          </button>
        </div>
      </div>
      
      {/* Settings Content */}
      <div className="flex-1 overflow-hidden bg-white p-10">
        <div className="max-w-3xl mx-auto h-full">
          {activeTab === 'subs' && <SubscriptionSettings onNavigateToInit={() => setActiveTab('db')} />}
          {activeTab === 'general' && (
             <div className="h-full flex flex-col pt-2 overflow-hidden">
               <div className="pb-6 mb-6 flex items-center justify-between border-b border-[#F4F4F5] shrink-0">
                 <div>
                   <h3 className="text-xl font-bold text-[#18181B] flex items-center gap-2 mb-1">
                      <Cog className="w-5 h-5 text-[#52525B]" />
                      通用
                   </h3>
                   <p className="text-sm text-[#71717A]">管理本地存储路径和应用偏好</p>
                 </div>
                 <Button
                   onClick={handleUpdateGeneral}
                   disabled={generalSaved}
                   className={`h-9 px-5 text-sm rounded-lg transition-all ${
                     generalSaved
                       ? 'bg-[#D4D4D8] text-[#71717A] cursor-not-allowed'
                       : 'bg-black text-white hover:bg-[#27272A]'
                   }`}
                 >
                   {generalSaved ? (
                     <>
                       <CheckCircle2 className="w-4 h-4 mr-1.5" />
                       已更新
                     </>
                   ) : '更新'}
                 </Button>
               </div>
               
               <div className="flex-1 space-y-8 overflow-y-auto">
                 {/* Local Article Directory */}
                 <div className="bg-[#F9F9FB] border border-[#E4E4E7] rounded-xl p-6">
                   <div className="flex items-start gap-3 mb-4">
                     <div className="p-2 bg-white rounded-lg border border-[#E4E4E7]">
                       <FolderOpen className="w-5 h-5 text-[#52525B]" />
                     </div>
                     <div>
                       <h4 className="font-semibold text-[#18181B] text-sm">本地文章目录</h4>
                       <p className="text-xs text-[#71717A] mt-1">
                         设置本地存储公众号文章的目录路径，应用将从此目录读取已下载的文章文件（支持 .html、.md、.txt、.json 格式）
                       </p>
                     </div>
                   </div>
                   <div className="flex items-center gap-3">
                     <input
                       type="text"
                       value={localArticleDir}
                       onChange={(e) => setLocalArticleDir(e.target.value)}
                       placeholder="例如: /Users/xxx/Documents/wechat-articles"
                       className="flex-1 h-9 px-3 text-sm bg-white border border-[#E4E4E7] rounded-lg outline-none focus:border-black transition-colors"
                     />
                     <Button
                       onClick={handleChooseDir}
                       variant="outline"
                       className="h-9 px-3 text-sm border border-[#E4E4E7] rounded-lg hover:bg-[#F4F4F5]"
                     >
                       <FolderOpen className="w-4 h-4" />
                     </Button>
                   </div>
                 </div>

                 {/* Max Query Limit */}
                 <div className="bg-[#F9F9FB] border border-[#E4E4E7] rounded-xl p-6">
                   <div className="flex items-start gap-3 mb-4">
                     <div className="p-2 bg-white rounded-lg border border-[#E4E4E7]">
                       <Cog className="w-5 h-5 text-[#52525B]" />
                     </div>
                     <div>
                       <h4 className="font-semibold text-[#18181B] text-sm">每次最大查询数</h4>
                       <p className="text-xs text-[#71717A] mt-1">
                         设置每次从微信数据库查询消息的最大条数，默认 5000，最大 10000。数值越大加载时间越长
                       </p>
                     </div>
                   </div>
                   <div className="flex items-center gap-3">
                     <input
                       type="number"
                       value={maxQueryLimit}
                       onChange={(e) => {
                         const val = parseInt(e.target.value, 10);
                         if (!isNaN(val)) setMaxQueryLimit(val);
                       }}
                       min={1}
                       max={MAX_ALLOWED_LIMIT}
                       placeholder={`默认 ${DEFAULT_MAX_QUERY_LIMIT}`}
                       className="w-40 h-9 px-3 text-sm bg-white border border-[#E4E4E7] rounded-lg outline-none focus:border-black transition-colors"
                     />
                     <span className="text-xs text-[#71717A]">条（1 - {MAX_ALLOWED_LIMIT}）</span>
                   </div>
                 </div>
               </div>
             </div>
          )}
          {activeTab === 'db' && <InitializationWizard onSuccess={() => setActiveTab('subs')} />}
        </div>
      </div>
    </div>
  );
}
