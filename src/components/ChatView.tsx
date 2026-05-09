import React, { useState } from 'react';
import { useAppStore } from '../store';
import { Contact, WeChatMessage } from '../types';
import { format } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Image as ImageIcon, Download, Search, SearchX } from 'lucide-react';

export function ChatView({ contact }: { contact: Contact }) {
  const { messages } = useAppStore();
  const [chatSearch, setChatSearch] = useState('');
  
  const contactMessages = messages
    .filter(m => m.contactId === contact.id)
    .filter(m => chatSearch ? (m.content && m.content.toLowerCase().includes(chatSearch.toLowerCase())) : true)
    .sort((a, b) => a.timestamp - b.timestamp);

  const renderMessageContent = (msg: WeChatMessage) => {
    switch (msg.contentType) {
      case 'text':
        return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{msg.content}</p>;
      case 'image':
        return (
          <div className="flex flex-col space-y-2 mt-1">
            <div className="max-w-[200px] aspect-square bg-[#F4F4F5] rounded-lg border border-dashed border-[#D4D4D8] flex items-center justify-center">
              <ImageIcon className="w-8 h-8 text-[#A1A1AA]" />
            </div>
          </div>
        );
      case 'file':
        return (
          <div className="flex items-center p-3 bg-white rounded-lg border border-[#E4E4E7] shadow-sm w-64 cursor-pointer hover:border-black transition-all mt-1">
            <div className="w-10 h-10 bg-[#F4F4F5] rounded flex items-center justify-center mr-3 shrink-0">
              <FileText className="w-5 h-5 text-[#52525B]" />
            </div>
            <div className="flex-1 min-w-0 pr-2">
              <p className="text-sm font-medium text-[#18181B] truncate" title={msg.content}>{msg.content}</p>
              <p className="text-[10px] text-[#A1A1AA] uppercase mt-1">
                {msg.metadata?.fileSize ? `${(msg.metadata.fileSize / 1024 / 1024).toFixed(1)} MB` : '未知大小'}
              </p>
            </div>
            <Download className="w-4 h-4 text-[#A1A1AA] hover:text-black" />
          </div>
        );
      default:
        return <p className="text-sm italic text-[#A1A1AA]">[不支持的消息类型]</p>;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#F9F9FB]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#E4E4E7] z-10 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#E4E4E7] flex items-center justify-center text-xs font-bold text-[#18181B]">
            {contact.name.charAt(0)}
          </div>
          <div>
            <h2 className="text-sm font-semibold">{contact.name}</h2>
            {contact.type === 'group' && (
              <p className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">{contact.memberCount} 成员</p>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#A1A1AA]" />
            <Input 
               placeholder="搜索聊天记录..." 
               className="pl-9 h-9 text-sm bg-[#F4F4F5] border-transparent focus-visible:ring-black focus-visible:bg-white rounded-lg transition-all"
               value={chatSearch}
               onChange={(e) => setChatSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" className="hidden sm:flex border-[#E4E4E7] hover:bg-[#F4F4F5] text-[#18181B] bg-white h-9">
            <Download className="w-4 h-4 mr-2" />
            导出
          </Button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {contactMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#A1A1AA] space-y-4">
              <div className="w-12 h-12 bg-[#F4F4F5] rounded border border-dashed border-[#D4D4D8] flex items-center justify-center">
                <SearchX className="w-6 h-6 text-[#A1A1AA]" />
              </div>
              <p className="text-sm font-medium">暂无聊天记录</p>
            </div>
          ) : (
            contactMessages.map((msg, index) => {
              const isMe = msg.senderId === 'me';
              const showSender = contact.type === 'group' && !isMe;
              const showTime = true; // In real app, only show if gap > 5 mins
              
              return (
                <div key={msg.id} className="flex flex-col">
                  {showTime && (
                    <div className="flex justify-center mb-4">
                      <span className="text-[10px] font-bold text-[#A1A1AA] bg-[#F4F4F5] px-2 py-0.5 rounded uppercase tracking-wider">
                        {format(msg.timestamp, 'HH:mm')}
                      </span>
                    </div>
                  )}
                  <div className={`flex items-end ${isMe ? 'justify-end' : 'justify-start'}`}>
                    {!isMe && (
                      <div className="w-8 h-8 rounded bg-[#E4E4E7] flex items-center justify-center text-[#18181B] font-bold mr-3 shrink-0 mb-1 text-xs">
                        {(msg.senderName || 'U').charAt(0)}
                      </div>
                    )}
                    
                    <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[70%]`}>
                      {showSender && <span className="text-[10px] text-[#A1A1AA] uppercase tracking-wider mb-1 ml-1">{msg.senderName}</span>}
                      
                      <div 
                        className={`
                          px-4 py-3 shadow-sm text-sm leading-relaxed
                          ${msg.contentType === 'file' ? 'bg-transparent shadow-none p-0' :
                            isMe 
                              ? 'bg-black text-white rounded-2xl rounded-br-sm' 
                              : 'bg-white border border-[#E4E4E7] text-[#52525B] rounded-2xl rounded-bl-sm'
                          }
                        `}
                      >
                        {renderMessageContent(msg)}
                      </div>
                    </div>
                    
                    {isMe && (
                      <div className="w-8 h-8 rounded bg-black flex items-center justify-center text-white font-bold ml-3 shrink-0 mb-1 text-[10px]">
                        我
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}
