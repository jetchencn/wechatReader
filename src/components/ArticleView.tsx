import React, { useState } from 'react';
import { useAppStore } from '../store';
import { Contact, Article } from '../types';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Check, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

export function ArticleView({ contact }: { contact: Contact }) {
  const { articles, downloadArticle } = useAppStore();
  const [articleSearch, setArticleSearch] = useState('');
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  
  const accountArticles = articles
    .filter(a => a.contactId === contact.id)
    .filter(a => articleSearch ? (a.title.toLowerCase().includes(articleSearch.toLowerCase()) || a.digest.toLowerCase().includes(articleSearch.toLowerCase())) : true)
    .sort((a, b) => b.publishTime - a.publishTime);

  const toggleSelect = (id: string, checked: boolean) => {
    const next = new Set(selectedArticles);
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    setSelectedArticles(next);
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedArticles(new Set(accountArticles.map(a => a.id)));
    } else {
      setSelectedArticles(new Set());
    }
  };

  const handleBatchDownload = () => {
    if (selectedArticles.size === 0) return;
    selectedArticles.forEach(id => {
      downloadArticle(id);
    });
    setSelectedArticles(new Set());
  };

  return (
    <div className="flex flex-col h-full bg-[#F9F9FB] relative">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 bg-white border-b border-[#E4E4E7] shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-[#E4E4E7] flex items-center justify-center text-[#18181B] font-bold shadow-sm">
            {contact.name.charAt(0)}
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[#18181B]">{contact.name}</h2>
            <p className="text-[10px] text-[#A1A1AA] uppercase tracking-wider mt-0.5">{contact.articleCount} 篇存档内容</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-64 hidden sm:block">
             <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#A1A1AA]" />
             <Input 
               placeholder="搜索文章..." 
               className="pl-9 h-9 text-sm bg-[#F4F4F5] border-transparent focus-visible:ring-black focus-visible:bg-white rounded-lg transition-all"
               value={articleSearch}
               onChange={(e) => setArticleSearch(e.target.value)}
             />
          </div>
          <Button variant="outline" size="sm" className="hidden sm:flex border-[#E4E4E7] hover:bg-[#F4F4F5] text-[#18181B] bg-white">
            <RefreshCw className="w-4 h-4 mr-2" />
            手动同步
          </Button>
          <Button 
            size="sm" 
            className="bg-black text-white hover:bg-[#27272A] rounded-lg"
            onClick={handleBatchDownload}
            disabled={selectedArticles.size === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            批量下载 ({selectedArticles.size})
          </Button>
        </div>
      </div>

      {/* Article List */}
      <div className="flex-1 overflow-y-auto p-8 relative">
        <div className="max-w-4xl mx-auto space-y-6">
          {accountArticles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#A1A1AA] space-y-4">
              <div className="aspect-video w-32 bg-[#F4F4F5] rounded border border-dashed border-[#D4D4D8] flex items-center justify-center">
                <span className="text-[10px]">无内容</span>
              </div>
              <p className="text-sm font-medium">暂无文章记录</p>
            </div>
          ) : (
            <>
              {/* Select All Bar */}
              <div className="flex items-center justify-between mb-4 bg-white p-3 rounded-lg border border-[#E4E4E7] shadow-sm sticky top-0 z-10">
                <div className="flex items-center space-x-3">
                  <Checkbox 
                    id="selectAll" 
                    checked={selectedArticles.size > 0 && selectedArticles.size === accountArticles.length}
                    onCheckedChange={(checked) => toggleSelectAll(checked as boolean)}
                    className="border-[#D4D4D8] data-[state=checked]:bg-black data-[state=checked]:text-white h-5 w-5 rounded transition-all shadow-sm"
                  />
                  <label htmlFor="selectAll" className="text-sm font-medium text-[#18181B] cursor-pointer">
                    全选
                  </label>
                  <span className="text-xs text-[#A1A1AA]">
                    (已选择 {selectedArticles.size} 篇)
                  </span>
                </div>
              </div>

              {accountArticles.map((article) => (
                <div 
                  key={article.id} 
                  className="flex gap-4 items-center group cursor-pointer"
                  onClick={() => toggleSelect(article.id, !selectedArticles.has(article.id))}
                >
                  <Checkbox 
                    checked={selectedArticles.has(article.id)}
                    className="border-[#D4D4D8] data-[state=checked]:bg-black data-[state=checked]:text-white h-5 w-5 rounded transition-all shadow-sm ml-2 shrink-0"
                    onCheckedChange={(checked) => toggleSelect(article.id, checked as boolean)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex flex-col sm:flex-row gap-6 p-5 rounded-xl border border-[#E4E4E7] bg-white shadow-sm hover:border-black hover:shadow-md transition-all flex-1 min-w-0">
                    <div className="w-full sm:w-56 h-36 bg-[#F4F4F5] rounded-lg shrink-0 flex items-center justify-center text-[#A1A1AA] overflow-hidden relative border border-[#E4E4E7]">
                      {article.coverImage ? (
                         <img src={article.coverImage} className="w-full h-full object-cover" alt="封面" />
                      ) : (
                         <div className="flex flex-col items-center justify-center gap-2">
                            <div className="w-8 h-10 bg-white border border-[#E4E4E7] rounded shadow-sm"></div>
                            <span className="text-[10px] uppercase font-bold text-[#A1A1AA]">封面缩略图</span>
                         </div>
                      )}
                    </div>
                    
                    <div className="flex-1 flex flex-col justify-between py-1 min-w-0">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                           <span className="text-[10px] bg-[#F4F4F5] text-[#71717A] px-2 py-0.5 rounded uppercase font-bold">推文</span>
                           {article.isDownloaded && (
                               <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded uppercase font-bold">已下载缓存</span>
                           )}
                        </div>
                        <h3 className="text-base font-semibold text-[#18181B] group-hover:underline decoration-2 underline-offset-4 transition-colors line-clamp-2">
                          {article.title}
                        </h3>
                        <p className="text-sm text-[#52525B] mt-2 line-clamp-2 leading-relaxed">
                          {article.digest}
                        </p>
                      </div>
                      
                      <div className="flex items-center justify-between mt-4 border-t border-[#F4F4F5] pt-4">
                        <div className="flex items-center space-x-4 text-[10px] font-bold text-[#A1A1AA] uppercase tracking-wider">
                          <span>{format(article.publishTime, 'yyyy-MM-dd')}</span>
                          <span>阅读 {article.readCount ? (article.readCount > 10000 ? '10w+' : article.readCount) : '-'}</span>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#A1A1AA] hover:text-[#18181B] hover:bg-[#F4F4F5]" title="在浏览器中打开" onClick={(e) => e.stopPropagation()}>
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          
                          {article.isDownloaded ? (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F4F4F5] rounded-lg text-xs font-medium text-[#18181B]">
                              <Check className="w-3.5 h-3.5 text-green-600" />
                              <span>已获取</span>
                            </div>
                          ) : (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 text-xs font-medium rounded-lg border-[#E4E4E7] hover:bg-[#F4F4F5] text-[#18181B] bg-white"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadArticle(article.id);
                              }}
                            >
                              下载本地
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
