import type { Entry, EntryInput, EntryListItem, ListEntriesParams, MetaInfo, Theme } from "./worklog";

declare global {
  interface Window {
    worklog: {
      getEntry(date: string): Promise<Entry | null>;
      upsertEntry(input: EntryInput): Promise<Entry>;
      listEntries(params?: ListEntriesParams): Promise<EntryListItem[]>;
      generateWeeklySummary(params: { weekStart: string; format: "markdown" | "text" }): Promise<string>;
      getMeta(): Promise<MetaInfo>;
      setTheme(theme: Theme): Promise<Theme>;
      copyToClipboard(text: string): Promise<boolean>;
      openDataFolder(): Promise<boolean>;
    };
  }
}

export {};
