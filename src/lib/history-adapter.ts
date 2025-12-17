import type { ThreadHistoryAdapter, ThreadMessage } from "@assistant-ui/react";

interface StoredHistoryMessage {
  message: ThreadMessage;
  parentId: string | null;
  runConfig?: unknown;
}

interface StoredData {
  headId?: string | null;
  messages: StoredHistoryMessage[];
  version: 1;
  savedAt: string;
}

const STORAGE_KEY = "gov_chat_history_v1";
const MAX_MESSAGES = 100;
const MAX_SIZE = 50 * 1024; // 50KB

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function shrinkRepository(repository: StoredData): StoredData {
  const next: StoredData = {
    headId: repository.headId,
    messages: [...repository.messages],
    version: 1,
    savedAt: repository.savedAt,
  };
  let json = JSON.stringify(next);
  while (json.length > MAX_SIZE && next.messages.length > 5) {
    const drop = Math.ceil(next.messages.length * 0.2);
    next.messages = next.messages.slice(drop);
    next.headId = next.messages[next.messages.length - 1]?.message.id ?? next.headId;
    json = JSON.stringify(next);
  }
  return next;
}

function readStoredData(): StoredData | null {
  if (!isBrowser()) {
    return null;
  }
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored) as StoredData;
    if (parsed.version !== 1 || !Array.isArray(parsed.messages)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("Failed to parse stored history:", error);
    return null;
  }
}

function writeStoredData(repository: StoredData): void {
  if (!isBrowser()) {
    return;
  }
  try {
    const shrunk = shrinkRepository(repository);
    const data: StoredData = {
      ...shrunk,
      savedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn("Failed to save history:", error);
  }
}

export function createSessionHistoryAdapter(): ThreadHistoryAdapter {
  return {
    async load(): Promise<any> {
      const stored = readStoredData();
      if (!stored) {
        return { headId: undefined, messages: [], unstable_resume: false };
      }
      const { version, savedAt, ...rest } = stored;
      return { ...rest, unstable_resume: false };
    },

    async append(item: StoredHistoryMessage): Promise<void> {
      const stored = readStoredData();
      const baseMessages = stored?.messages ?? [];
      const combined = [...baseMessages, item].slice(-MAX_MESSAGES);
      const nextHeadId = item.message.id ?? stored?.headId ?? undefined;
      const nextRepo: StoredData = {
        headId: nextHeadId,
        messages: combined,
        version: 1,
        savedAt: new Date().toISOString(),
      };
      writeStoredData(nextRepo);
    },
  };
}
