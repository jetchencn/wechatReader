import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { InitializationWizard } from './InitializationWizard';
import { Database, Settings, Shield, Zap, FolderSync, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SubscriptionSettings } from './SubscriptionSettings';

export function SettingsView() {
  const { isInitialized, setShowWizard, contacts } = useAppStore();
  const [activeTab, setActiveTab] = useState(isInitialized ? 'subs' : 'db');

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
            onClick={() => setActiveTab('subs')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'subs' ? 'bg-[#E4E4E7] text-black shadow-sm' : 'text-[#71717A] hover:bg-[#F4F4F5]'}`}
          >
            <FolderSync className="w-4 h-4" />
            订阅设置
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
          {activeTab === 'security' && (
             <div className="h-full flex flex-col pt-2">
               <div className="mb-8">
                 <h3 className="text-xl font-bold text-[#18181B] flex items-center gap-2 mb-1">
                    <Shield className="w-5 h-5 text-[#52525B]" />
                    安全与隐私
                 </h3>
                 <p className="text-sm text-[#71717A]">管理数据安全和隐私策略</p>
               </div>
               
               <div className="flex-1 border-t border-[#F4F4F5] py-12 flex flex-col items-center justify-center text-center">
                 <div className="w-20 h-20 bg-[#F9F9FB] rounded-2xl flex items-center justify-center mb-6 border border-[#E4E4E7]">
                    <Shield className="w-10 h-10 text-[#71717A]" />
                 </div>
                 <h4 className="text-lg font-bold text-[#18181B] mb-2">本地隔离环境已开启</h4>
                 <p className="text-sm text-[#71717A] max-w-sm">
                   所有微信数据库解析和内容分析均在您本地运行。
                   插件通过沙箱环境隔离外界访问，确保您的聊天记录不会上传至互联网。
                 </p>
               </div>
             </div>
          )}
          {activeTab === 'performance' && (
             <div className="h-full flex flex-col pt-2">
               <div className="mb-8">
                 <h3 className="text-xl font-bold text-[#18181B] flex items-center gap-2 mb-1">
                    <Zap className="w-5 h-5 text-[#52525B]" />
                    高级选项
                 </h3>
                 <p className="text-sm text-[#71717A]">调整应用性能和底层解析策略</p>
               </div>
               
               <div className="flex-1 border-t border-[#F4F4F5] py-12 flex flex-col items-center justify-center text-center">
                 <div className="w-20 h-20 bg-[#F9F9FB] rounded-2xl flex items-center justify-center mb-6 border border-[#E4E4E7]">
                    <Zap className="w-10 h-10 text-[#71717A]" />
                 </div>
                 <h4 className="text-lg font-bold text-[#18181B] mb-2">高性能索引已就绪</h4>
                 <p className="text-sm text-[#71717A] max-w-sm">
                   系统已自动优化 SQLite 预读策略。对于特大规模数据库，您可以开启流式解析模式。
                 </p>
               </div>
             </div>
          )}
          {activeTab === 'db' && <InitializationWizard onSuccess={() => setActiveTab('subs')} />}
        </div>
      </div>
    </div>
  );
}
