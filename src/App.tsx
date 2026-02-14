import { formatDistanceToNow, parseISO } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getTodayKey, getWeekStartMonday, toDisplayDate } from "./lib/date";
import { buildDailySummary } from "./lib/summary";
import type { Entry, EntryInput, EntryListItem, MetaInfo, Theme } from "./types/worklog";

type ViewId = "today" | "history" | "weekly" | "settings";
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type EntryDraft = Pick<EntryInput, "done" | "blocked" | "next">;

const VIEWS: { id: ViewId; label: string; description: string }[] = [
  { id: "today", label: "Today", description: "Capture daily progress quickly" },
  { id: "history", label: "History", description: "Browse and edit previous entries" },
  { id: "weekly", label: "Weekly Summary", description: "Generate your status update" },
  { id: "settings", label: "Settings", description: "Theme and local data path" },
];

const EMPTY_DRAFT: EntryDraft = {
  done: "",
  blocked: "",
  next: "",
};

function toDraft(entry: Entry | null): EntryDraft {
  if (!entry) {
    return { ...EMPTY_DRAFT };
  }
  return {
    done: entry.done ?? "",
    blocked: entry.blocked ?? "",
    next: entry.next ?? "",
  };
}

function getPreviewFromDraft(draft: EntryDraft): string {
  const candidates = [draft.done, draft.blocked, draft.next];
  for (const candidate of candidates) {
    const line = candidate
      .split(/\r?\n/g)
      .map((item) => item.trim())
      .find(Boolean);
    if (line) {
      return line.slice(0, 180);
    }
  }
  return "";
}

function isSameDraft(left: EntryDraft, right: EntryDraft): boolean {
  return left.done === right.done && left.blocked === right.blocked && left.next === right.next;
}

function getSaveLabel(saveState: SaveState): string {
  switch (saveState) {
    case "dirty":
      return "Unsaved changes";
    case "saving":
      return "Saving...";
    case "saved":
      return "Saved";
    case "error":
      return "Save failed";
    default:
      return "No changes";
  }
}

function safeRelativeTime(isoValue: string): string {
  try {
    return formatDistanceToNow(parseISO(isoValue), { addSuffix: true });
  } catch {
    return "recently";
  }
}

function EntryEditor({
  dateKey,
  draft,
  saveState,
  onChange,
  onSaveNow,
  headerAction,
}: {
  dateKey: string;
  draft: EntryDraft;
  saveState: SaveState;
  onChange: (field: keyof EntryDraft, value: string) => void;
  onSaveNow: () => void;
  headerAction?: ReactNode;
}) {
  return (
    <section className="panel fade-up">
      <header className="panel-header">
        <div>
          <h2>{toDisplayDate(dateKey)}</h2>
          <p>{getSaveLabel(saveState)}</p>
        </div>
        <div className="panel-actions">
          {headerAction}
          <button type="button" className="secondary-button" onClick={onSaveNow}>
            Save now (Ctrl+S)
          </button>
        </div>
      </header>
      <label className="field-group">
        <span>Done</span>
        <textarea
          value={draft.done}
          onChange={(event) => onChange("done", event.target.value)}
          placeholder="Ship completed tasks, decisions, and wins"
        />
      </label>
      <label className="field-group">
        <span>Blocked</span>
        <textarea
          value={draft.blocked}
          onChange={(event) => onChange("blocked", event.target.value)}
          placeholder="Dependencies, risks, and open blockers"
        />
      </label>
      <label className="field-group">
        <span>Next</span>
        <textarea
          value={draft.next}
          onChange={(event) => onChange("next", event.target.value)}
          placeholder="What is next on your queue"
        />
      </label>
    </section>
  );
}

function TodayView() {
  const [dateKey, setDateKey] = useState(getTodayKey());
  const [draft, setDraft] = useState<EntryDraft>({ ...EMPTY_DRAFT });
  const [baseline, setBaseline] = useState<EntryDraft>({ ...EMPTY_DRAFT });
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [copyState, setCopyState] = useState("Copy Today Summary");
  const copyStateTimer = useRef<number | null>(null);

  const isDirty = useMemo(() => !isSameDraft(draft, baseline), [baseline, draft]);

  const loadEntry = useCallback(async () => {
    setIsLoading(true);
    try {
      const entry = await window.worklog.getEntry(dateKey);
      const nextDraft = toDraft(entry);
      setDraft(nextDraft);
      setBaseline(nextDraft);
      setSaveState("saved");
    } catch {
      setDraft({ ...EMPTY_DRAFT });
      setBaseline({ ...EMPTY_DRAFT });
      setSaveState("error");
    } finally {
      setIsLoading(false);
    }
  }, [dateKey]);

  useEffect(() => {
    void loadEntry();
  }, [loadEntry]);

  const saveNow = useCallback(async () => {
    if (isLoading) {
      return;
    }
    setSaveState("saving");
    try {
      const savedEntry = await window.worklog.upsertEntry({
        date: dateKey,
        done: draft.done,
        blocked: draft.blocked,
        next: draft.next,
      });
      const nextDraft = toDraft(savedEntry);
      setDraft(nextDraft);
      setBaseline(nextDraft);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [dateKey, draft.blocked, draft.done, draft.next, isLoading]);

  useEffect(() => {
    if (isLoading || !isDirty) {
      return;
    }
    setSaveState("dirty");
    const timeout = window.setTimeout(() => {
      void saveNow();
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [isDirty, isLoading, saveNow]);

  useEffect(() => {
    const onSaveShortcut = () => {
      void saveNow();
    };
    window.addEventListener("worklog:save-shortcut", onSaveShortcut as EventListener);
    return () => {
      window.removeEventListener("worklog:save-shortcut", onSaveShortcut as EventListener);
    };
  }, [saveNow]);

  useEffect(() => {
    return () => {
      if (copyStateTimer.current !== null) {
        window.clearTimeout(copyStateTimer.current);
      }
    };
  }, []);

  const setField = useCallback((field: keyof EntryDraft, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
  }, []);

  const copyTodaySummary = useCallback(async () => {
    const summary = buildDailySummary({
      date: dateKey,
      done: draft.done,
      blocked: draft.blocked,
      next: draft.next,
    });
    await window.worklog.copyToClipboard(summary);
    setCopyState("Copied");
    if (copyStateTimer.current !== null) {
      window.clearTimeout(copyStateTimer.current);
    }
    copyStateTimer.current = window.setTimeout(() => {
      setCopyState("Copy Today Summary");
    }, 1200);
  }, [dateKey, draft.blocked, draft.done, draft.next]);

  return (
    <div className="view-stack">
      <section className="surface fade-up">
        <label className="date-picker-label" htmlFor="today-date">
          Log date
        </label>
        <input
          id="today-date"
          type="date"
          value={dateKey}
          onChange={(event) => setDateKey(event.target.value)}
          className="date-picker"
        />
      </section>
      <EntryEditor
        dateKey={dateKey}
        draft={draft}
        saveState={saveState}
        onChange={setField}
        onSaveNow={() => {
          void saveNow();
        }}
        headerAction={
          <button type="button" className="secondary-button" onClick={() => void copyTodaySummary()}>
            {copyState}
          </button>
        }
      />
    </div>
  );
}

function HistoryView() {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [draft, setDraft] = useState<EntryDraft>({ ...EMPTY_DRAFT });
  const [baseline, setBaseline] = useState<EntryDraft>({ ...EMPTY_DRAFT });
  const [isLoadingEntry, setIsLoadingEntry] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const isDirty = useMemo(() => !isSameDraft(draft, baseline), [baseline, draft]);

  useEffect(() => {
    let isCancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const nextEntries = await window.worklog.listEntries({ q: query, limit: 120 });
        if (isCancelled) {
          return;
        }
        setEntries(nextEntries);
        if (nextEntries.length === 0) {
          setSelectedDate("");
          return;
        }
        setSelectedDate((previous) => {
          if (previous && nextEntries.some((item) => item.date === previous)) {
            return previous;
          }
          return nextEntries[0].date;
        });
      } catch {
        if (!isCancelled) {
          setEntries([]);
        }
      }
    }, 220);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    if (!selectedDate) {
      setDraft({ ...EMPTY_DRAFT });
      setBaseline({ ...EMPTY_DRAFT });
      setSaveState("idle");
      return;
    }

    let isCancelled = false;
    setIsLoadingEntry(true);
    void window.worklog
      .getEntry(selectedDate)
      .then((entry) => {
        if (isCancelled) {
          return;
        }
        const nextDraft = toDraft(entry);
        setDraft(nextDraft);
        setBaseline(nextDraft);
        setSaveState("saved");
      })
      .catch(() => {
        if (!isCancelled) {
          setSaveState("error");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingEntry(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedDate]);

  const setField = useCallback((field: keyof EntryDraft, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
  }, []);

  const saveNow = useCallback(async () => {
    if (!selectedDate || isLoadingEntry) {
      return;
    }

    setSaveState("saving");
    try {
      const savedEntry = await window.worklog.upsertEntry({
        date: selectedDate,
        done: draft.done,
        blocked: draft.blocked,
        next: draft.next,
      });
      const nextDraft = toDraft(savedEntry);
      setDraft(nextDraft);
      setBaseline(nextDraft);
      setSaveState("saved");
      setEntries((previous) => {
        const updatedItem: EntryListItem = {
          date: selectedDate,
          updated_at: savedEntry.updated_at,
          preview: getPreviewFromDraft(nextDraft),
        };
        const remaining = previous.filter((item) => item.date !== selectedDate);
        return [updatedItem, ...remaining].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
      });
    } catch {
      setSaveState("error");
    }
  }, [draft.blocked, draft.done, draft.next, isLoadingEntry, selectedDate]);

  useEffect(() => {
    if (!selectedDate || isLoadingEntry || !isDirty) {
      return;
    }
    setSaveState("dirty");
    const timeout = window.setTimeout(() => {
      void saveNow();
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [isDirty, isLoadingEntry, saveNow, selectedDate]);

  useEffect(() => {
    const onSaveShortcut = () => {
      void saveNow();
    };
    window.addEventListener("worklog:save-shortcut", onSaveShortcut as EventListener);
    return () => {
      window.removeEventListener("worklog:save-shortcut", onSaveShortcut as EventListener);
    };
  }, [saveNow]);

  return (
    <div className="history-layout fade-up">
      <section className="panel history-list">
        <header className="panel-header">
          <div>
            <h2>History</h2>
            <p>Search by date or text content</p>
          </div>
        </header>
        <label className="field-group">
          <span>Search</span>
          <input
            type="text"
            className="text-input"
            placeholder="Find entries..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="history-items">
          {entries.length === 0 ? <p className="empty-state">No entries yet.</p> : null}
          {entries.map((entry) => (
            <button
              key={entry.date}
              type="button"
              className={`history-item ${selectedDate === entry.date ? "selected" : ""}`}
              onClick={() => setSelectedDate(entry.date)}
            >
              <div>
                <strong>{toDisplayDate(entry.date)}</strong>
                <span>{safeRelativeTime(entry.updated_at)}</span>
              </div>
              <p>{entry.preview || "No preview yet"}</p>
            </button>
          ))}
        </div>
      </section>
      {selectedDate ? (
        <EntryEditor
          dateKey={selectedDate}
          draft={draft}
          saveState={saveState}
          onChange={setField}
          onSaveNow={() => {
            void saveNow();
          }}
        />
      ) : (
        <section className="panel fade-up">
          <h2>No history selected</h2>
          <p className="empty-state">Create a log in Today first, then edit it here.</p>
        </section>
      )}
    </div>
  );
}

function WeeklySummaryView() {
  const [selectedDate, setSelectedDate] = useState(getTodayKey());
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState("Loading summary...");
  const [copyState, setCopyState] = useState("Copy Markdown");
  const weekStart = useMemo(() => getWeekStartMonday(selectedDate), [selectedDate]);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    let isCancelled = false;
    setStatus("Loading summary...");
    void window.worklog
      .generateWeeklySummary({ weekStart, format: "markdown" })
      .then((nextSummary) => {
        if (!isCancelled) {
          setSummary(nextSummary);
          setStatus("Summary generated");
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setSummary("");
          setStatus("Could not generate summary");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [weekStart]);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) {
        window.clearTimeout(copyTimer.current);
      }
    };
  }, []);

  const copySummary = useCallback(async () => {
    if (!summary) {
      return;
    }
    await window.worklog.copyToClipboard(summary);
    setCopyState("Copied");
    if (copyTimer.current !== null) {
      window.clearTimeout(copyTimer.current);
    }
    copyTimer.current = window.setTimeout(() => {
      setCopyState("Copy Markdown");
    }, 1200);
  }, [summary]);

  return (
    <div className="view-stack fade-up">
      <section className="surface">
        <label className="date-picker-label" htmlFor="summary-date">
          Pick any date in the target week
        </label>
        <input
          id="summary-date"
          type="date"
          value={selectedDate}
          className="date-picker"
          onChange={(event) => setSelectedDate(event.target.value)}
        />
        <p className="helper-text">Week starts Monday: {weekStart}</p>
      </section>
      <section className="panel">
        <header className="panel-header">
          <div>
            <h2>Weekly Summary</h2>
            <p>{status}</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => void copySummary()}>
            {copyState}
          </button>
        </header>
        <textarea className="summary-preview" value={summary} readOnly />
      </section>
    </div>
  );
}

function SettingsView({
  meta,
  theme,
  onThemeChange,
}: {
  meta: MetaInfo | null;
  theme: Theme;
  onThemeChange: (nextTheme: Theme) => Promise<void>;
}) {
  return (
    <section className="panel fade-up">
      <header className="panel-header">
        <div>
          <h2>Settings</h2>
          <p>Everything is local-only and stored on your device</p>
        </div>
      </header>
      <div className="setting-row">
        <div>
          <strong>Theme</strong>
          <p>Choose your preferred reading mode.</p>
        </div>
        <div className="theme-toggle">
          <button
            type="button"
            className={theme === "light" ? "theme-active" : ""}
            onClick={() => void onThemeChange("light")}
          >
            Light
          </button>
          <button
            type="button"
            className={theme === "dark" ? "theme-active" : ""}
            onClick={() => void onThemeChange("dark")}
          >
            Dark
          </button>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <strong>Data location</strong>
          <p>{meta?.dbPath ?? "Loading..."}</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void window.worklog.openDataFolder()}>
          Open folder
        </button>
      </div>
      <div className="setting-row">
        <div>
          <strong>App version</strong>
          <p>{meta?.appVersion ?? "..."}</p>
        </div>
      </div>
    </section>
  );
}

function CommandPalette({
  isOpen,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (view: ViewId) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  const filteredViews = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return VIEWS;
    }
    return VIEWS.filter((view) => {
      return (
        view.label.toLowerCase().includes(normalized) || view.description.toLowerCase().includes(normalized)
      );
    });
  }, [query]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className="text-input"
          placeholder="Jump to..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="palette-list">
          {filteredViews.map((view) => (
            <button
              key={view.id}
              type="button"
              className="palette-item"
              onClick={() => {
                onSelect(view.id);
                onClose();
              }}
            >
              <strong>{view.label}</strong>
              <span>{view.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeView, setActiveView] = useState<ViewId>("today");
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    let isCancelled = false;
    void window.worklog
      .getMeta()
      .then((nextMeta) => {
        if (isCancelled) {
          return;
        }
        setMeta(nextMeta);
        setTheme(nextMeta.theme);
      })
      .catch(() => {
        if (!isCancelled) {
          setMeta(null);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        window.dispatchEvent(new Event("worklog:save-shortcut"));
        return;
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const changeTheme = useCallback(async (nextTheme: Theme) => {
    const appliedTheme = await window.worklog.setTheme(nextTheme);
    setTheme(appliedTheme);
    setMeta((previous) => (previous ? { ...previous, theme: appliedTheme } : previous));
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Worklog</h1>
          <p>Local-first personal updates</p>
        </div>
        <nav className="nav-links">
          {VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              className={`nav-link ${activeView === view.id ? "active" : ""}`}
              onClick={() => setActiveView(view.id)}
            >
              <strong>{view.label}</strong>
              <span>{view.description}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p>
            Ctrl+K quick switch
            <br />
            Ctrl+S save now
          </p>
        </div>
      </aside>
      <main className="main-area">
        <header className="page-header">
          <h2>{VIEWS.find((view) => view.id === activeView)?.label}</h2>
          <button type="button" className="secondary-button" onClick={() => setPaletteOpen(true)}>
            Open command palette
          </button>
        </header>
        {activeView === "today" ? <TodayView /> : null}
        {activeView === "history" ? <HistoryView /> : null}
        {activeView === "weekly" ? <WeeklySummaryView /> : null}
        {activeView === "settings" ? <SettingsView meta={meta} theme={theme} onThemeChange={changeTheme} /> : null}
      </main>
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelect={(view) => setActiveView(view)}
      />
    </div>
  );
}

export default App;
