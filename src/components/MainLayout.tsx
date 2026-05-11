import React, { useEffect } from 'react';
import { useAppStore } from '../store';
import { Sidebar } from './Sidebar';
import { ContentArea } from './ContentArea';
import { SettingsView } from './SettingsView';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export function MainLayout() {
  const { isInitialized, showWizard, setShowWizard, selectedContactId, selectedViewId, views, selectView } = useAppStore();

  // Auto-show wizard if not initialized
  useEffect(() => {
    if (!isInitialized) {
      setShowWizard(true);
    }
  }, [isInitialized, setShowWizard]);

  // Default to first view if initialized and nothing selected
  useEffect(() => {
    if (isInitialized && !selectedContactId && !selectedViewId && views.length > 0) {
      selectView(views[0].id);
    }
  }, [isInitialized, selectedContactId, selectedViewId, views, selectView]);

  return (
    <div className="flex flex-col h-screen bg-[#F4F4F5] text-[#18181B] font-sans overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#E4E4E7]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" viewBox="0 0 100 100" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M 12 25 L 34 80 L 55 25 L 76 80 L 88 45" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx="92" cy="16" r="10" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <span className="font-semibold text-lg tracking-tight italic">WechatReader</span>
          <div className="h-4 w-[1px] bg-[#E4E4E7] mx-2"></div>
          <span className="text-sm text-[#71717A]">私有化微信内容管理</span>
        </div>
        <div className="flex items-center gap-4">
          {isInitialized ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F4F4F5] rounded-full text-xs font-medium">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              同步正常
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F4F4F5] rounded-full text-xs font-medium text-[#71717A]">
              <span className="w-2 h-2 bg-[#A1A1AA] rounded-full"></span>
              未配置
            </div>
          )}
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <Sidebar className="w-64 bg-white border-r border-[#E4E4E7] flex flex-col" />
        <section className="flex-1 flex flex-col relative bg-[#F9F9FB] border-l border-[#E4E4E7] overflow-hidden">
          <ContentArea />
        </section>
      </main>

      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="sm:max-w-4xl w-full max-w-4xl h-[80vh] p-0 overflow-hidden flex border-0">
          <SettingsView />
        </DialogContent>
      </Dialog>
    </div>
  );
}
