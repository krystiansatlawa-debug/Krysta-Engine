export type UbisoftRecordingBaseline = {
  scope: string;
  observedAt: number;
  unlocked: ReadonlySet<string>;
};
type Achievement = { id: string; title: string; unlocked: boolean };
export function advanceUbisoftRecordingBaseline(
  previous: UbisoftRecordingBaseline | null,
  scope: string,
  items: readonly Achievement[],
  now: number
) {
  // Ignore malformed achievement identifiers and avoid duplicate notifications
  // when a provider returns the same achievement more than once.
  const unlocked = new Set(
    items
      .filter((item) => item.unlocked && item.id.trim())
      .map((item) => item.id)
  );
  const continuous =
    previous !== null &&
    previous.scope === scope &&
    now >= previous.observedAt &&
    now - previous.observedAt <= 45000;
  const notified = new Set<string>();
  const newTitles = continuous
    ? items
        .filter((item) => {
          if (
            !item.unlocked ||
            !item.id.trim() ||
            previous.unlocked.has(item.id) ||
            notified.has(item.id)
          )
            return false;
          notified.add(item.id);
          return true;
        })
        .map((item) => item.title)
    : [];
  // Keep seen unlocks even if the service later reports an achievement as locked.
  const seen = continuous
    ? new Set([...previous.unlocked, ...unlocked])
    : unlocked;
  return { baseline: { scope, observedAt: now, unlocked: seen }, newTitles };
}
