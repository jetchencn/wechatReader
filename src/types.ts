export type ContactType = 'person' | 'group' | 'official_account';
export type ContentType = 'text' | 'image' | 'file' | 'link' | 'article' | 'video' | 'voice';

export interface Contact {
  id: string;
  type: ContactType;
  name: string;
  avatar?: string;
  lastMessageTime?: number;
  messageCount?: number;
  isSubscribed: boolean;
  memberCount?: number; // For groups
  articleCount?: number; // For official accounts
}

export interface MessageMetadata {
  filePath?: string;
  url?: string;
  thumbnail?: string;
  fileSize?: number;
  duration?: number;
}

export interface WeChatMessage {
  id: string;
  type: ContactType;
  contactId: string;
  senderId?: string;
  senderName?: string;
  contentType: ContentType;
  content: string;
  timestamp: number;
  metadata?: MessageMetadata;
  isRead: boolean;
}

export interface Article {
  id: string;
  contactId: string; // Official account ID
  title: string;
  digest: string;
  url: string;
  coverImage?: string;
  author?: string;
  publishTime: number;
  readCount?: number;
  isDownloaded: boolean;
}

export interface SavedView {
  id: number;
  name: string;
  icon: string;
  isSystem: boolean;
  filters: {
    types?: ContactType[];
    contentTypes?: ContentType[];
    contactIds?: string[];
    timeRange?: string; // 'today', '7days', '30days', 'custom'
  };
}
