import React, { useState } from 'react';
import { useAppStore } from '../store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, SearchX, FolderSync } from 'lucide-react';

export function SubscriptionSettings() {
  const { contacts, subscribeContacts, unsubscribeContact } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  // Contacts that are subscribed vs all
  const filteredContacts = contacts.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || c.type === filterType;
    return matchesSearch && matchesType;
  });

  const handleToggleContact = (id: string, isSubscribed: boolean) => {
    if (isSubscribed) {
      unsubscribeContact(id);
    } else {
      subscribeContacts([id]);
    }
  };

  const subscribedCount = contacts.filter(c => c.isSubscribed).length;

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h3 className="text-xl font-bold text-[#18181B] flex items-center gap-2 mb-1">
             <FolderSync className="w-5 h-5 text-[#52525B]" />
             订阅设置
          </h3>
          <p className="text-sm text-[#71717A]">选择希望在应用中显示并分析的联系人、群组和公众号</p>
        </div>
        <div className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold uppercase tracking-wider">
          已订阅 {subscribedCount}
        </div>
      </div>
      
      <div className="flex gap-2 mb-4">
        <button 
          onClick={() => setFilterType('all')}
          className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${filterType === 'all' ? 'bg-black text-white' : 'bg-[#E4E4E7] text-[#71717A] hover:bg-[#D4D4D8]'}`}
        >
          全部
        </button>
        <button 
          onClick={() => setFilterType('person')}
          className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${filterType === 'person' ? 'bg-black text-white' : 'bg-[#E4E4E7] text-[#71717A] hover:bg-[#D4D4D8]'}`}
        >
          通讯录
        </button>
        <button 
          onClick={() => setFilterType('group')}
          className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${filterType === 'group' ? 'bg-black text-white' : 'bg-[#E4E4E7] text-[#71717A] hover:bg-[#D4D4D8]'}`}
        >
          群聊
        </button>
        <button 
          onClick={() => setFilterType('official_account')}
          className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${filterType === 'official_account' ? 'bg-black text-white' : 'bg-[#E4E4E7] text-[#71717A] hover:bg-[#D4D4D8]'}`}
        >
          公众号
        </button>
      </div>

      <div className="bg-[#F4F4F5] p-3 rounded-xl flex items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#A1A1AA]" />
          <Input 
            placeholder="搜索要订阅的名称..." 
            className="pl-9 bg-white border-[#E4E4E7] focus-visible:ring-black h-10 text-sm rounded-lg"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button 
          variant="outline" 
          onClick={() => {
            const ids = filteredContacts.filter(c => !c.isSubscribed).map(c => c.id);
            subscribeContacts(ids);
          }} 
          className="border-[#E4E4E7] text-[#18181B] bg-white h-10 hover:bg-[#F9F9FB]"
        >
          本页全选
        </Button>
      </div>
      
      <div className="flex-1 bg-white border border-[#E4E4E7] rounded-xl overflow-hidden shadow-sm">
         <ScrollArea className="h-full">
            <div className="p-2 space-y-1">
              {filteredContacts.map(contact => (
                <div 
                  key={contact.id} 
                  className={`flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer transition-colors border ${
                     contact.isSubscribed ? 'bg-[#F4F4F5] border-[#E4E4E7] shadow-sm' : 'border-transparent hover:bg-[#FAFAFA]'
                  }`}
                  onClick={() => handleToggleContact(contact.id, contact.isSubscribed)}
                >
                  <div className="flex items-center space-x-4 overflow-hidden">
                    <Checkbox 
                      checked={contact.isSubscribed}
                      className={contact.isSubscribed ? 'border-black bg-black text-white' : 'border-[#D4D4D8]'}
                      onCheckedChange={() => handleToggleContact(contact.id, contact.isSubscribed)}
                    />
                    <div className="w-8 h-8 rounded bg-[#E4E4E7] flex items-center justify-center text-[#18181B] font-bold shrink-0 text-sm">
                      {contact.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#18181B] truncate">{contact.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                         <span className="text-[10px] bg-[#E4E4E7] text-[#71717A] px-1.5 py-0.5 rounded uppercase font-bold">
                           {contact.type === 'person' && `好友`}
                           {contact.type === 'group' && `群聊`}
                           {contact.type === 'official_account' && `号主`}
                         </span>
                         <span className="text-[10px] text-[#A1A1AA] uppercase font-bold tracking-wider">
                           {contact.messageCount} 归档记录
                         </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {filteredContacts.length === 0 && (
                <div className="py-20 text-center flex flex-col items-center">
                   <SearchX className="w-8 h-8 text-[#E4E4E7] mb-2" />
                   <span className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-widest">无匹配结果</span>
                </div>
              )}
            </div>
         </ScrollArea>
      </div>
    </div>
  );
}
