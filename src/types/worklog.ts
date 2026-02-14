export type Theme = "light" | "dark";

export interface Entry {
  date: string;
  done: string;
  blocked: string;
  next: string;
  created_at: string;
  updated_at: string;
}

export interface EntryInput {
  date: string;
  done: string;
  blocked: string;
  next: string;
}

export interface EntryListItem {
  date: string;
  updated_at: string;
  preview: string;
}

export interface ListEntriesParams {
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface MetaInfo {
  appVersion: string;
  dbPath: string;
  theme: Theme;
}
