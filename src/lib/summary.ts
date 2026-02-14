type SummaryEntry = {
  date: string;
  done: string;
  blocked: string;
  next: string;
};

export function splitToBullets(text: string): string[] {
  if (!text) {
    return [];
  }

  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectSection(entries: SummaryEntry[], key: "done" | "blocked" | "next"): string[] {
  const items: string[] = [];
  for (const entry of entries) {
    const lines = splitToBullets(entry[key]);
    for (const line of lines) {
      items.push(`- ${entry.date}: ${line}`);
    }
  }
  return items;
}

export function buildWeeklySummary(
  entries: SummaryEntry[],
  weekStart: string,
  format: "markdown" | "text" = "markdown",
): string {
  const sortedEntries = [...entries].sort((left, right) => left.date.localeCompare(right.date));
  const doneItems = collectSection(sortedEntries, "done");
  const blockedItems = collectSection(sortedEntries, "blocked");
  const nextItems = collectSection(sortedEntries, "next");

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

export function buildDailySummary(entry: SummaryEntry): string {
  return buildWeeklySummary([entry], entry.date, "markdown");
}
