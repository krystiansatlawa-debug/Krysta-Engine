/** The game details panel should show cached status immediately and avoid
 * a network request on every navigation within the same session.
 * Manual "Check now" always bypasses this policy.
 */
export function needsAutomaticGameUpdateRefresh(
  watch: {
    lastChecked?: string | null;
    updateCheckedAt?: string | null;
    updateState?: string | null;
  } | null | undefined,
  now = Date.now(),
  ttlMs = 5 * 60_000
): boolean {
  if (!watch) return true;
  const dates = [watch.lastChecked, watch.updateCheckedAt]
    .filter((s): s is string => typeof s === "string" && !!s)
    .map((s) => Date.parse(s))
    .filter(Number.isFinite);
  if (dates.length === 0) return true;
  // News can fail independently from the platform. A recent provider status
  // is enough to avoid duplicating a remote check immediately on navigation.
  const newest = Math.max(...dates);
  return newest > now || now - newest >= ttlMs;
}
