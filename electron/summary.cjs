const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseDateKey(dateKey) {
  if (!DATE_KEY_REGEX.test(dateKey)) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function getWeekStartMonday(dateKey) {
  const date = parseDateKey(dateKey);
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return formatDateKey(date);
}

function addDays(dateKey, days) {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

function splitToBullets(text) {
  if (!text) {
    return [];
  }

  return String(text)
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildSection(entries, key) {
  const items = [];

  for (const entry of entries) {
    const bullets = splitToBullets(entry[key]);
    for (const bullet of bullets) {
      items.push(`- ${entry.date}: ${bullet}`);
    }
  }

  return items;
}

function generateWeeklySummary(entries, weekStart, format = "markdown") {
  const sortedEntries = [...entries].sort((left, right) => left.date.localeCompare(right.date));
  const doneItems = buildSection(sortedEntries, "done");
  const blockedItems = buildSection(sortedEntries, "blocked");
  const nextItems = buildSection(sortedEntries, "next");

  if (format === "text") {
    const lines = [`Week of ${weekStart}`];
    if (doneItems.length > 0) {
      lines.push("", "Done", ...doneItems);
    }
    if (blockedItems.length > 0) {
      lines.push("", "Blocked", ...blockedItems);
    }
    if (nextItems.length > 0) {
      lines.push("", "Next", ...nextItems);
    }
    if (doneItems.length === 0 && blockedItems.length === 0 && nextItems.length === 0) {
      lines.push("", "No entries logged this week.");
    }
    return lines.join("\n").trim();
  }

  const lines = [`# Week of ${weekStart}`];
  if (doneItems.length > 0) {
    lines.push("", "## Done", ...doneItems);
  }
  if (blockedItems.length > 0) {
    lines.push("", "## Blocked", ...blockedItems);
  }
  if (nextItems.length > 0) {
    lines.push("", "## Next", ...nextItems);
  }
  if (doneItems.length === 0 && blockedItems.length === 0 && nextItems.length === 0) {
    lines.push("", "No entries logged this week.");
  }
  return lines.join("\n").trim();
}

module.exports = {
  addDays,
  generateWeeklySummary,
  getWeekStartMonday,
  splitToBullets,
};
