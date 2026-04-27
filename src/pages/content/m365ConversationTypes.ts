export type M365MessageRole = 'user' | 'assistant';

export interface M365TextContent {
  kind: 'text';
  text: string;
}

export interface M365ImageContent {
  kind: 'image';
  src: string;
  currentSrc: string;
  alt: string;
  title: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  loading: string;
  visible: boolean;
}

export type M365ContentItem = M365TextContent | M365ImageContent;

export interface M365RawMessageCandidate {
  role: M365MessageRole;
  element: Element;
  contentElement: Element;
  rawText: string;
  images: M365ImageContent[];
  ordinal: number;
  visible: boolean;
  className: string;
  roleAttribute: string;
}

export interface M365RawConversation {
  timestamp: string;
  url: string;
  rawUserNodeCount: number;
  rawAssistantNodeCount: number;
  logicalCandidateCount: number;
  candidates: M365RawMessageCandidate[];
}

export interface CanonicalMessage {
  id: string;
  fingerprint: string;
  role: M365MessageRole;
  text: string;
  content: M365ContentItem[];
  imageCount: number;
  index: number;
  visible: boolean;
  className: string;
  roleAttribute: string;
  sourceElement: Element;
  contentElement: Element;
}

export interface CanonicalConversation {
  timestamp: string;
  url: string;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  totalImages: number;
  messages: CanonicalMessage[];
  rawStats: {
    rawUserNodeCount: number;
    rawAssistantNodeCount: number;
    logicalCandidateCount: number;
  };
}
