import { captureM365Conversation } from '@/platforms/m365/conversation/snapshotAdapter';

import { CanonicalConversationBuilder } from './m365CanonicalConversation';
import { M365ConversationExtractor } from './m365ConversationExtractor';
import type { CanonicalConversation } from './m365ConversationTypes';

export function extractM365CanonicalConversation(): CanonicalConversation {
  return CanonicalConversationBuilder.build(M365ConversationExtractor.extract());
}

export function extractM365ConversationCapture() {
  return captureM365Conversation(extractM365CanonicalConversation());
}
