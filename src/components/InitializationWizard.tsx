import React, { useState } from 'react';
import { useAppStore } from '../store';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, Loader2, Play, RefreshCw, XCircle, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Step {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  error?: string;
  details?: string;
}

export function InitializationWizard({ onSuccess }: { onSuccess?: () => void }) {
  const { isInitialized, setInitialized, setShowWizard } = useAppStore();
  const [steps, setSteps] = useState<Step[]>([
    { id: 'process', name: '检测微信进程', status: 'pending', details: '检测微信是否正在运行并已登录' },
    { id: 'path', name: '分析数据路径', status: 'pending', details: '定位微信本地数据库文件存储目录' },
    { id: 'init', name: '执行初始化', status: 'pending', details: '解析通讯录及关联归档数据' },
  ]);
  const [isExecuting, setIsExecuting] = useState(false);

  const updateStepStatus = (id: string, status: Step['status'], error?: string, details?: string) => {
    setSteps(prev => prev.map(s => 
      s.id === id ? { ...s, status, error, details: details || s.details } : s
    ));
  };

  const resetSteps = () => {
    setSteps(prev => prev.map(s => ({ ...s, status: 'pending', error: undefined })));
  };

  const startInitialization = async () => {
    setIsExecuting(true);
    resetSteps();

    // Step 1: Detect Process
    updateStepStatus('process', 'running');
    await new Promise(r => setTimeout(r, 1500));
    const processSuccess = true; // Simulated success
    if (processSuccess) {
      updateStepStatus('process', 'success', undefined, '已找到微信进程 (C:\\Program Files\\Tencent\\WeChat\\WeChat.exe)');
    } else {
      updateStepStatus('process', 'error', '未发现微信进程，请确保微信已启动并登录');
      setIsExecuting(false);
      return;
    }

    // Step 2: Data Path
    updateStepStatus('path', 'running');
    await new Promise(r => setTimeout(r, 1200));
    const pathSuccess = true; // Simulated success
    if (pathSuccess) {
      updateStepStatus('path', 'success', undefined, '已自动定位数据目录 (WeChat Files\\wxid_...\\Msg)');
    } else {
      updateStepStatus('path', 'error', '无法自动定位数据路径，请手动指引');
      setIsExecuting(false);
      return;
    }

    // Step 3: Initialization
    updateStepStatus('init', 'running');
    await new Promise(r => setTimeout(r, 2000));
    const initSuccess = true; // Simulated success
    if (initSuccess) {
      updateStepStatus('init', 'success', undefined, '成功解析 1,204 条联系人记录');
      
      // Give UI a moment to show the success state of the final step
      await new Promise(r => setTimeout(r, 800));
      
      setInitialized(true);
      setIsExecuting(false);
    } else {
      updateStepStatus('init', 'error', '初始化过程中发生未知错误，请重试');
      setIsExecuting(false);
    }
  };

  return (
    <div className="h-full flex flex-col pt-2">
      <div className="mb-8">
        <h3 className="text-xl font-bold text-[#18181B] flex items-center gap-2 mb-1">
          <Database className="w-5 h-5 text-[#52525B]" />
          初始化配置
        </h3>
        <p className="text-sm text-[#71717A]">检测微信环境并准备同步本地归档数据</p>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex-1 space-y-8 pb-10 border-t border-[#F4F4F5] pt-10">
          {steps.map((step, index) => (
            <div key={step.id} className="relative">
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="absolute left-[15px] top-[32px] bottom-[-32px] w-[2px] bg-[#F4F4F5]" />
              )}
              
              <div className="flex items-start gap-5">
                <div className="relative z-10 shrink-0 w-8 h-8 flex items-center justify-center">
                  {step.status === 'pending' && (
                    <div className="w-3 h-3 rounded-full bg-[#E4E4E7]" />
                  )}
                  {step.status === 'running' && (
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                  )}
                  {step.status === 'success' && (
                    <div className="bg-green-100 rounded-full p-1 shadow-sm">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    </div>
                  )}
                  {step.status === 'error' && (
                    <XCircle className="w-7 h-7 text-red-500" />
                  )}
                </div>
                
                <div className="flex-1 pt-0.5">
                  <div className="flex items-center justify-between mb-1">
                    <p className={`text-base font-bold transition-colors ${
                      step.status === 'running' ? 'text-blue-600' : 
                      step.status === 'success' ? 'text-[#18181B]' : 'text-[#71717A]'
                    }`}>
                      {step.name}
                    </p>
                    <div className="flex items-center gap-2">
                      {step.status === 'running' && (
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-lg font-bold uppercase tracking-wider animate-pulse border border-blue-100">执行中</span>
                      )}
                      {step.status === 'success' && (
                        <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-lg font-bold uppercase tracking-wider border border-green-100">已完成</span>
                      )}
                      {step.status === 'error' && (
                        <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-lg font-bold uppercase tracking-wider border border-red-100">失败</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="min-h-[20px]">
                    {step.status === 'error' && step.error ? (
                      <p className="text-sm text-red-500 flex items-center gap-1.5 font-medium">
                        <AlertCircle className="w-4 h-4" />
                        {step.error}
                      </p>
                    ) : (
                      <p className={`text-sm transition-colors ${step.status === 'success' ? 'text-[#71717A]' : 'text-[#A1A1AA]'}`}>
                        {step.details}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-auto py-8 flex items-center justify-between border-t border-[#F4F4F5]">
          <div className="text-sm text-[#71717A]">
            {isInitialized ? (
              <span className="flex items-center gap-2 text-green-600 font-bold">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                系统已就绪
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#E4E4E7]" />
                等待系统同步数据
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            {isInitialized && !isExecuting && (
              <Button 
                onClick={onSuccess}
                className="bg-black text-white hover:bg-[#27272A] rounded-xl px-8 h-12 shadow-md flex items-center gap-2.5 font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                前往订阅设置
                <ArrowRight className="w-5 h-5" />
              </Button>
            )}
            {!isInitialized || isExecuting ? (
              <Button 
                onClick={startInitialization}
                disabled={isExecuting}
                className={`rounded-xl px-10 h-12 font-bold shadow-sm transition-all ${
                  isInitialized 
                    ? 'bg-white border-2 border-[#E4E4E7] text-[#18181B] hover:bg-[#F4F4F5]' 
                    : 'bg-black text-white hover:bg-[#27272A] shadow-md'
                }`}
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                    开始同步...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-3" />
                    开始检测并同步
                  </>
                )}
              </Button>
            ) : (
              <Button 
                variant="outline"
                onClick={startInitialization}
                className="rounded-xl px-6 h-12 border-2 border-[#E4E4E7] text-[#71717A] hover:bg-[#F4F4F5] font-bold"
              >
                <RefreshCw className="w-5 h-5 mr-3" />
                重新检测
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const Database = ({ className }: { className?: string }) => (
  <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M3 5V19A9 3 0 0 0 21 19V5"/>
    <path d="M3 12A9 3 0 0 0 21 12"/>
  </svg>
);
