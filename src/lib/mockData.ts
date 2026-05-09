import { Contact, WeChatMessage, Article, SavedView } from '../types';

const now = Date.now();
const hour = 60 * 60 * 1000;
const day = 24 * hour;

export const mockContacts: Contact[] = [
  { id: 'c1', type: 'person', name: '张三', lastMessageTime: now - 2 * hour, messageCount: 1234, isSubscribed: false },
  { id: 'c2', type: 'person', name: '李四', lastMessageTime: now - 25 * hour, messageCount: 342, isSubscribed: false },
  { id: 'g1', type: 'group', name: 'family群', memberCount: 12, lastMessageTime: now - 3 * hour, messageCount: 5678, isSubscribed: false },
  { id: 'g2', type: 'group', name: 'work群', memberCount: 28, lastMessageTime: now - 1 * hour, messageCount: 890, isSubscribed: false },
  { id: 'o1', type: 'official_account', name: '36氪', articleCount: 156, lastMessageTime: now - 4 * hour, messageCount: 156, isSubscribed: false },
  { id: 'o2', type: 'official_account', name: '虎嗅', articleCount: 89, lastMessageTime: now - 1.5 * day, messageCount: 89, isSubscribed: false },
];

export const mockMessages: WeChatMessage[] = [
  { id: 'm1', type: 'person', contactId: 'c1', senderId: 'c1', senderName: '张三', contentType: 'text', content: '好的，明天下午3点会议室见', timestamp: now - 2 * hour, isRead: true },
  { id: 'm2', type: 'person', contactId: 'c1', senderId: 'me', senderName: '我', contentType: 'text', content: '明天下午有空吗？想讨论一下项目', timestamp: now - 2 * hour - 2 * 60000, isRead: true },
  { id: 'm3', type: 'person', contactId: 'c1', senderId: 'c1', senderName: '张三', contentType: 'file', content: '项目需求文档_v2.pdf', metadata: { fileSize: 2.3 * 1024 * 1024 }, timestamp: now - 2 * hour - 15 * 60000, isRead: true },
  { id: 'm4', type: 'group', contactId: 'g1', senderId: 'c2', senderName: '李四', contentType: 'image', content: '[图片]', timestamp: now - 3 * hour, isRead: false },
  { id: 'm5', type: 'group', contactId: 'g1', senderId: 'c1', senderName: '张三', contentType: 'text', content: '周末去哪儿玩？', timestamp: now - 3 * hour - 5 * 60000, isRead: false },
];

export const mockArticles: Article[] = [
  { id: 'a1', contactId: 'o1', title: 'AI助手将改变世界', digest: '深入解析AI在各大行业的潜在革命。', url: '#', publishTime: now - 4 * hour, readCount: 12050, isDownloaded: true },
  { id: 'a2', contactId: 'o1', title: '新能源汽车销量创新高', digest: '本月各家车企交付量出炉。', url: '#', publishTime: now - 2 * day, readCount: 8900, isDownloaded: false },
  { id: 'a3', contactId: 'o2', title: '今年科技圈的十大趋势', digest: '带你前瞻下半年科技发展。', url: '#', publishTime: now - 1.5 * day, readCount: 4500, isDownloaded: true },
];

export const mockViews: SavedView[] = [
  { id: 1, name: '今天消息', icon: '📅', isSystem: true, filters: { timeRange: 'today' } },
  { id: 2, name: '近7天消息', icon: '📅', isSystem: true, filters: { timeRange: '7days' } },
  { id: 3, name: '公众号文章', icon: '📖', isSystem: true, filters: { types: ['official_account'] } },
  { id: 4, name: '含文件消息', icon: '📎', isSystem: true, filters: { contentTypes: ['file'] } },
];
