import { format, parseISO, startOfWeek } from "date-fns";

export function getTodayKey(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function formatDateKey(input: Date): string {
  return format(input, "yyyy-MM-dd");
}

export function toDisplayDate(dateKey: string): string {
  return format(parseISO(dateKey), "EEE, MMM d, yyyy");
}

export function getWeekStartMonday(dateKey: string): string {
  const baseDate = parseISO(dateKey);
  return format(startOfWeek(baseDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
}
