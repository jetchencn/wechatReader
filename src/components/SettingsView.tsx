import React, { useState } from 'react';
import { useAppStore } from '../store';
import { InitializationWizard } from './InitializationWizard';
import { Database, Settings, Shield, Zap, FolderSync } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SubscriptionSettings } from './SubscriptionSettings';

export function SettingsView() {
  const [activeTab, setActiveTab] = useState('db');
  const { setShowWizard } = useAppStore();

  return (
    <div className="flex h-full bg-white z-10 w-full overflow-hidden">
      {/* Settings Sidebar */}
      <div className="w-56 border-r border-[#E4E4E7] bg-[#F9F9FB] flex flex-col shrink-0">
        <div className="p-4 border-b border-[#E4E4E7] flex items-center justify-between">
          <h2 className="font-semibold text-[#18181B] flex items-center gap-2">
            <Settings className="w-4 h-4" />
            系统配置
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setShowWizard(false)} className="h-6 w-6 p-0 hover:bg-[#E4E4E7] rounded-md text-[#71717A]">
             ✕
          </Button>
        </div>
        <div className="p-3 flex-1 flex flex-col gap-1.5 overflow-auto">
          <button 
            onClick={() => setActiveTab('db')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'db' ? 'bg-[#E4E4E7] text-black shadow-sm' : 'text-[#71717A] hover:bg-[#F4F4F5]'}`}
          >
            <Database className="w-4 h-4" />
            初始化
          </button>
          <button 
            onClick={() => setActiveTab('subs')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'subs' ? 'bg-[#E4E4E7] text-black shadow-sm' : 'text-[#71717A] hover:bg-[#F4F4F5]'}`}
          >
            <FolderSync className="w-4 h-4" />
            订阅设置
          </button>
          <button 
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'general' ? 'bg-[#E4E4E7] text-black shadow-sm' : 'text-[#71717A] hover:bg-[#F4F4F5]'}`}
          >
            <Settings className="w-4 h-4" />
            常规设置
          </button>
          <button 
            onClick={() => setActiveTab('security')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'security' ? 'bg-[#E4E4E7] text-black shadow-sm' : 'text-[#71717A] hover:bg-[#F4F4F5]'}`}
          >
            <Shield className="w-4 h-4" />
            安全隐私
          </button>
          <button 
            onClick={() => setActiveTab('performance')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'performance' ? 'bg-[#E4E4E7] text-black shadow-sm' : 'text-[#71717A] hover:bg-[#F4F4F5]'}`}
          >
            <Zap className="w-4 h-4" />
            高级选项
          </button>
        </div>
      </div>
      
      {/* Settings Content */}
      <div className="flex-1 overflow-hidden bg-[#F4F4F5]">
        {activeTab === 'db' && <InitializationWizard onComplete={() => setActiveTab('subs')} />}
        {activeTab === 'subs' && <SubscriptionSettings />}
        {activeTab === 'general' && (
           <div className="p-10 max-w-2xl mx-auto h-full flex flex-col">
             <h3 className="text-xl font-bold mb-6 text-[#18181B] flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#52525B]" />
                常规设置
             </h3>
             <div className="bg-white border text-sm text-[#71717A] border-[#E4E4E7] rounded-xl p-8 shadow-sm flex-1 flex items-center justify-center">
                <div className="text-center">
                   <div className="w-16 h-16 bg-[#F4F4F5] rounded-full flex items-center justify-center mx-auto mb-4">
                      <Settings className="w-8 h-8 text-[#A1A1AA]" />
                   </div>
                   <p className="font-semibold text-[#18181B] mb-1">暂无配置项</p>
                   <p className="text-[12px] text-[#A1A1AA]">更多常规设置选项将在后续版本开放</p>
                </div>
             </div>
           </div>
        )}
        {activeTab === 'security' && (
           <div className="p-10 max-w-2xl mx-auto h-full flex flex-col">
             <h3 className="text-xl font-bold mb-6 text-[#18181B] flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#52525B]" />
                安全与隐私
             </h3>
             <div className="bg-white border text-sm text-[#71717A] border-[#E4E4E7] rounded-xl p-8 shadow-sm flex-1 flex items-center justify-center">
                <div className="text-center">
                   <div className="w-16 h-16 bg-[#F4F4F5] rounded-full flex items-center justify-center mx-auto mb-4">
                      <Shield className="w-8 h-8 text-[#A1A1AA]" />
                   </div>
                   <p className="font-semibold text-[#18181B] mb-1">数据安全保证</p>
                   <p className="text-[12px] text-[#A1A1AA]">所有解析均在本地环境运行，隔离外网环境保证安全</p>
                </div>
             </div>
           </div>
        )}
        {activeTab === 'performance' && (
           <div className="p-10 max-w-2xl mx-auto h-full flex flex-col">
             <h3 className="text-xl font-bold mb-6 text-[#18181B] flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#52525B]" />
                高级选项
             </h3>
             <div className="bg-white border text-sm text-[#71717A] border-[#E4E4E7] rounded-xl p-8 shadow-sm flex-1 flex items-center justify-center">
                <div className="text-center">
                   <div className="w-16 h-16 bg-[#F4F4F5] rounded-full flex items-center justify-center mx-auto mb-4">
                      <Zap className="w-8 h-8 text-[#A1A1AA]" />
                   </div>
                   <p className="font-semibold text-[#18181B] mb-1">性能与缓存管理</p>
                   <p className="text-[12px] text-[#A1A1AA]">目前索引缓存已经自动优化</p>
                </div>
             </div>
           </div>
        )}
      </div>
    </div>
  );
}
