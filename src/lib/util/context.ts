export function pickContextWindow<T>(items: T[], centerIndex: number, maxItems: number): T[] {
  const limit = Math.max(0, Math.trunc(maxItems));
  if (limit === 0) return [];
  if (items.length === 0) return [];
  if (centerIndex < 0 || centerIndex >= items.length) return items.slice(-limit);

  const beforeStart = Math.max(0, centerIndex - limit);
  const before = items.slice(beforeStart, centerIndex);
  const remaining = limit - before.length;
  const after = remaining > 0 ? items.slice(centerIndex + 1, centerIndex + 1 + remaining) : [];
  return [...before, ...after];
}

