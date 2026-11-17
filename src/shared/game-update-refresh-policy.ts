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
  const providerTime = watch.updateCheckedAt
    ? Date.parse(watch.updateCheckedAt) : NaN;
  // Official provider status matters more than a recent unrelated news post.
  // Do not keep stale "update required" or "up to date" flags merely because
  // the Steam news feed was fetched more recently.
  if (watch.updateState && watch.updateState !== "unknown" &&
      Number.isFinite(providerTime))
    return providerTime > now || now - providerTime >= ttlMs;

  const dates = [watch.lastChecked, watch.updateCheckedAt]
    .filter((date): date is string => typeof date === "string" && !!date)
    .map((date) => Date.parse(date))
    .filter(Number.isFinite);
  if (dates.length === 0) return true;
  const newest = Math.max(...dates);
  return newest > now || now - newest >= ttlMs;
}
