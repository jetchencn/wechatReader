import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, CheckCircle2, Loader2, Search, SearchX } from 'lucide-react';

interface InitializationWizardProps {
  onComplete?: () => void;
}

export function InitializationWizard({ onComplete }: InitializationWizardProps) {
  const [step, setStep] = useState(1);
  const { setInitialized } = useAppStore();
  
  // Step states
  const [checkingProcess, setCheckingProcess] = useState(true);
  const [processFound, setProcessFound] = useState(false);
  const [checkingPath, setCheckingPath] = useState(false);
  const [pathFound, setPathFound] = useState(false);
  const [customPath, setCustomPath] = useState('C:\\Users\\Admin\\Documents\\WeChat Files\\wxid_123456\\Msg\\');
  const [decrypting, setDecrypting] = useState(false);
  const [decryptProgress, setDecryptProgress] = useState(0);

  // Simulate Step 1: Detect Process
  useEffect(() => {
    if (step === 1) {
      const timer = setTimeout(() => {
        setProcessFound(true);
        setCheckingProcess(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [step]);

  // Simulate Step 2 & 3: Path and Decrypt
  useEffect(() => {
    if (step === 2) {
      setCheckingPath(true);
      const timer = setTimeout(() => {
        setPathFound(true);
        setCheckingPath(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
    
    if (step === 3) {
      setDecrypting(true);
      let p = 0;
      const timer = setInterval(() => {
        p += 20;
        setDecryptProgress(p);
        if (p >= 100) {
          clearInterval(timer);
          setDecrypting(false);
        }
      }, 400);
      return () => clearInterval(timer);
    }
  }, [step]);

  const handleNext = () => setStep(s => s + 1);
  const handlePrev = () => setStep(s => s - 1);
  
  const handleComplete = () => {
    setInitialized(true);
    if (onComplete) {
      onComplete();
    } else {
      useAppStore.getState().setShowWizard(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-full w-full bg-[#F4F4F5] text-[#18181B] font-sans p-6 overflow-hidden">
      <div className="w-full max-w-4xl h-full flex flex-col overflow-hidden bg-white border border-[#E4E4E7] rounded-2xl shadow-xl">
        <header className="flex items-center justify-between px-6 py-4 bg-[#F9F9FB] border-b border-[#E4E4E7]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" viewBox="0 0 100 100" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M 12 25 L 34 80 L 55 25 L 76 80 L 88 45" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" />
                <circle cx="92" cy="16" r="10" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <span className="font-semibold text-lg tracking-tight italic">Wichat Reader</span>
            <div className="h-4 w-[1px] bg-[#E4E4E7] mx-2"></div>
            <span className="text-[10px] text-[#A1A1AA] uppercase tracking-widest font-bold">初始化向导</span>
          </div>
          <div className="flex items-center gap-2">
             {[1, 2, 3].map(s => (
                <div key={s} className="flex gap-1">
                   <div className={`w-8 h-1.5 rounded-full ${s <= step ? 'bg-black' : 'bg-[#E4E4E7]'} transition-colors`} />
                </div>
              ))}
          </div>
        </header>
        
        <main className="p-8 flex-1 overflow-auto flex flex-col justify-center">
          {/* Step 1 */}
          {step === 1 && (
            <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto">
               <div className="bg-white border-2 border-black rounded-xl p-8 shadow-md w-full text-center">
                  <div className="flex items-center justify-center mb-6">
                    <div className="w-10 h-10 bg-black text-white rounded-lg flex items-center justify-center text-sm font-bold italic">1</div>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">检测微信进程</h3>
                  
                  <div className="mt-6">
                    {checkingProcess ? (
                      <div className="flex flex-col items-center gap-4 text-[#71717A]">
                         <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                         <span className="text-[10px] uppercase tracking-widest font-bold">扫描本地进程中...</span>
                      </div>
                    ) : (
                      processFound ? (
                        <div className="flex flex-col items-center gap-3">
                           <div className="px-3 py-1 bg-green-50 text-green-600 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                             <CheckCircle2 className="w-4 h-4" />
                             发现微信进程
                           </div>
                           <div className="flex flex-col items-center bg-[#F4F4F5] border border-[#E4E4E7] p-4 rounded-lg w-full mt-2">
                              <span className="text-[10px] text-[#A1A1AA] uppercase tracking-wider font-bold mb-1">执行路径</span>
                              <span className="text-xs text-[#52525B] break-all text-center">C:\Program Files\Tencent\WeChat\WeChat.exe</span>
                           </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-3">
                           <div className="px-3 py-1 bg-yellow-50 text-yellow-600 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                             <AlertCircle className="w-4 h-4" />
                             未找到进程
                           </div>
                           <p className="text-sm text-[#71717A] mt-2">请先启动 PC 微信并登录</p>
                        </div>
                      )
                    )}
                  </div>
               </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
             <div className="flex flex-col w-full max-w-md mx-auto">
                <div className="bg-white border-2 border-black rounded-xl p-8 shadow-md w-full">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-black text-white rounded-lg flex items-center justify-center text-xs font-bold italic">2</div>
                      <h3 className="text-base font-semibold">分析数据路径</h3>
                    </div>
                  </div>
                  
                  <div className="mt-2">
                    {checkingPath ? (
                      <div className="aspect-video bg-[#F4F4F5] rounded-xl border border-dashed border-[#D4D4D8] flex flex-col items-center justify-center gap-3">
                         <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                         <span className="text-[10px] text-[#52525B] uppercase tracking-widest font-bold">寻址中...</span>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-[#F9F9FB] border border-[#E4E4E7] p-4 rounded-xl flex items-start gap-3">
                           <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                           <div>
                              <p className="text-sm font-medium text-[#18181B] mb-1">自动检测成功</p>
                              <p className="text-xs text-[#71717A] font-mono bg-white p-2 border border-[#E4E4E7] rounded truncate" title={customPath}>{customPath}</p>
                           </div>
                        </div>
                        
                        <div className="pt-2">
                          <label className="text-[10px] text-[#A1A1AA] uppercase tracking-wider font-bold mb-2 block">手动调整路径配置 (非必填)</label>
                          <Input 
                            value={customPath} 
                            onChange={(e) => setCustomPath(e.target.value)} 
                            placeholder="C:\Users\...\WeChat Files..."
                            className="bg-[#F4F4F5] border-[#E4E4E7] focus-visible:ring-black rounded-lg text-xs"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto">
               <div className="bg-white border-2 border-black rounded-xl p-8 shadow-md w-full">
                  <div className="flex items-center gap-3 mb-6 justify-center">
                    <div className="w-8 h-8 bg-black text-white rounded-lg flex items-center justify-center text-xs font-bold italic">3</div>
                    <h3 className="text-base font-semibold">数据库脱机解析</h3>
                  </div>
                  
                  <div className="mt-4">
                     {decrypting ? (
                        <div className="space-y-4 text-center">
                           <div className="h-2 w-full bg-[#F4F4F5] rounded-full overflow-hidden border border-[#E4E4E7]">
                             <div className="h-full bg-black transition-all duration-300 ease-out" style={{ width: `${decryptProgress}%` }}></div>
                           </div>
                           <p className="text-[10px] text-[#A1A1AA] uppercase font-bold tracking-widest">{decryptProgress}% 解析中...</p>
                        </div>
                      ) : (
                        <div className="bg-green-50 text-green-800 p-6 rounded-xl border border-green-200 flex flex-col items-center gap-3 text-center">
                          <span className="text-2xl">🎉</span>
                          <p className="text-sm font-semibold">解密测试通过</p>
                          <p className="text-[10px] uppercase font-bold text-green-600 tracking-wider">成功解析 1204 个联系列表</p>
                        </div>
                      )}
                  </div>
               </div>
            </div>
          )}
        </main>
        
        <footer className="flex justify-between items-center px-8 py-5 border-t border-[#E4E4E7] bg-[#F9F9FB] shrink-0">
          <Button 
            variant="outline" 
            onClick={handlePrev} 
            disabled={step === 1 || checkingProcess || checkingPath || decrypting}
            className="border-[#E4E4E7] text-[#18181B] bg-white hover:bg-[#F4F4F5] rounded-xl text-sm px-6 h-10 shadow-sm"
          >
            上一步
          </Button>
          
          {step < 3 ? (
            <Button 
              onClick={handleNext} 
              disabled={
                (step === 1 && (!processFound || checkingProcess)) || 
                (step === 2 && checkingPath)
              }
              className="bg-black text-white hover:bg-[#27272A] rounded-xl text-sm font-medium px-8 h-10 shadow-md"
            >
              下一步
            </Button>
          ) : (
            <Button 
              onClick={handleComplete} 
              disabled={decrypting}
              className="bg-black text-white hover:bg-[#27272A] rounded-xl text-sm font-medium px-8 h-10 shadow-md"
            >
              完成
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
