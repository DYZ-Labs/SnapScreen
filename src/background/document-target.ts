export interface DocumentTarget {
  tabId: number;
  documentId?: string;
}

export function getDocumentMessageOptions(
  target: DocumentTarget,
): chrome.tabs.MessageSendOptions {
  return target.documentId ? { documentId: target.documentId } : {};
}
