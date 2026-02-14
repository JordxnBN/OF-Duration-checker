const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { addDays, generateWeeklySummary, getWeekStartMonday } = require("./summary.cjs");

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const THEME_VALUES = new Set(["light", "dark"]);

function assertDateKey(date) {
  if (!DATE_KEY_REGEX.test(date)) {
    throw new Error(`Invalid date key: ${date}`);
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trimEnd() : "";
}

function getPreviewFromRow(row) {
  const candidates = [row.done, row.blocked, row.next];
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

function runMigrations(db) {
  const version = Number(db.pragma("user_version", { simple: true }) ?? 0);
  if (version >= 1) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      done TEXT NOT NULL DEFAULT '',
      blocked TEXT NOT NULL DEFAULT '',
      next TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entries_updated_at ON entries(updated_at DESC);
  `);

  db.pragma("user_version = 1");
}

function createStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  runMigrations(db);

  const getEntryStatement = db.prepare(`
    SELECT date, done, blocked, next, created_at, updated_at
    FROM entries
    WHERE date = @date
  `);

  const upsertEntryStatement = db.prepare(`
    INSERT INTO entries (date, done, blocked, next, created_at, updated_at)
    VALUES (@date, @done, @blocked, @next, @timestamp, @timestamp)
    ON CONFLICT(date) DO UPDATE SET
      done = excluded.done,
      blocked = excluded.blocked,
      next = excluded.next,
      updated_at = excluded.updated_at
  `);

  const getEntriesByRangeStatement = db.prepare(`
    SELECT date, done, blocked, next
    FROM entries
    WHERE date BETWEEN @from AND @to
    ORDER BY date ASC
  `);

  const getSettingStatement = db.prepare(`
    SELECT value
    FROM settings
    WHERE key = @key
  `);

  const setSettingStatement = db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  function getEntry(date) {
    assertDateKey(date);
    return getEntryStatement.get({ date }) ?? null;
  }

  function upsertEntry(input) {
    assertDateKey(input.date);
    const timestamp = new Date().toISOString();
    upsertEntryStatement.run({
      date: input.date,
      done: normalizeText(input.done),
      blocked: normalizeText(input.blocked),
      next: normalizeText(input.next),
      timestamp,
    });
    return getEntry(input.date);
  }

  function listEntries({ q = "", from, to, limit = 60, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const where = [];
    const params = {
      limit: safeLimit,
      offset: safeOffset,
    };

    if (typeof q === "string" && q.trim()) {
      where.push("(date LIKE @query OR done LIKE @query OR blocked LIKE @query OR next LIKE @query)");
      params.query = `%${q.trim()}%`;
    }

    if (from) {
      assertDateKey(from);
      where.push("date >= @from");
      params.from = from;
    }

    if (to) {
      assertDateKey(to);
      where.push("date <= @to");
      params.to = to;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const statement = db.prepare(`
      SELECT date, updated_at, done, blocked, next
      FROM entries
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT @limit
      OFFSET @offset
    `);

    const rows = statement.all(params);
    return rows.map((row) => ({
      date: row.date,
      updated_at: row.updated_at,
      preview: getPreviewFromRow(row),
    }));
  }

  function getTheme() {
    const row = getSettingStatement.get({ key: "theme" });
    return THEME_VALUES.has(row?.value) ? row.value : "light";
  }

  function setTheme(theme) {
    if (!THEME_VALUES.has(theme)) {
      throw new Error("Theme must be 'light' or 'dark'.");
    }
    setSettingStatement.run({
      key: "theme",
      value: theme,
    });
    return theme;
  }

  function getWeekEntries(weekStart) {
    assertDateKey(weekStart);
    const normalizedWeekStart = getWeekStartMonday(weekStart);
    const weekEnd = addDays(normalizedWeekStart, 6);
    return getEntriesByRangeStatement.all({
      from: normalizedWeekStart,
      to: weekEnd,
    });
  }

  function createWeeklySummary({ weekStart, format = "markdown" }) {
    const normalizedWeekStart = getWeekStartMonday(weekStart);
    const entries = getWeekEntries(normalizedWeekStart);
    return generateWeeklySummary(entries, normalizedWeekStart, format);
  }

  function close() {
    db.close();
  }

  return {
    close,
    createWeeklySummary,
    getEntry,
    getTheme,
    listEntries,
    setTheme,
    upsertEntry,
  };
}

module.exports = {
  createStore,
};
