/** A folder discovered after startup may already contain newly earned achievements.
 * The first nonempty observation must be merged; a subsequent identical snapshot must not.
 */
export const hasNewFolderAchievements = (
  previous: ReadonlySet<string> | undefined,
  current: ReadonlySet<string>
): boolean => {
  if (!previous) return current.size > 0;
  for (const name of current) if (!previous.has(name)) return true;
  return false;
};
