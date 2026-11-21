import type { CloudSavePathContext, Game } from "@types";
import { getCloudSavePathContext } from "./cloud-save/cloud-save-game-context";
import { cloudSaveCustomPathContextFromPathContext } from "./cloud-save/custom-path";
import { getCloudSaveCustomPathRules } from "./cloud-save/custom-path-store";
import { Ludusavi } from "./ludusavi";
import { NativeAddon } from "./native-addon";
import { SystemPath } from "./system-path";
import {
  readLatestStorySave,
  type StorySaveScan,
  type StorySaveSource,
} from "./story-progress-save";

async function nativeSaveFiles(
  game: Game,
  context: CloudSavePathContext,
  canRead: () => boolean
) {
  const [manifestRules, customRules] = await Promise.all([
    NativeAddon.getSaveRulesForGame({
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
      remoteId: game.remoteId ?? undefined,
      userDataPath: SystemPath.getPath("userData"),
    })
      .then(({ rules }) => rules)
      .catch(() => []),
    getCloudSaveCustomPathRules(
      game.shop,
      game.objectId,
      cloudSaveCustomPathContextFromPathContext(context)
    ).catch(() => []),
  ]);
  if (!canRead() || (!manifestRules.length && !customRules.length)) return [];
  return NativeAddon.scanLocalSaveRuleFiles(context, [
    ...manifestRules,
    ...customRules,
  ]);
}

export async function readHydraStorySave(
  game: Game,
  source: StorySaveSource,
  canRead: () => boolean,
  signal: AbortSignal
): Promise<StorySaveScan> {
  const context = canRead()
    ? await getCloudSavePathContext(game.objectId, game.shop)
        .then(({ pathContext }) => pathContext)
        .catch(() => undefined)
    : undefined;
  const parseFiles = (detectedFiles: string[]) =>
    readLatestStorySave(source, { profiles: [], detectedFiles }, canRead);

  const native =
    context && canRead()
      ? await nativeSaveFiles(game, context, canRead).catch(() => [])
      : [];
  const nativeResult = await parseFiles(native);
  if (nativeResult.status === "ready" || nativeResult.status === "waiting")
    return nativeResult;

  const preview =
    canRead() && !signal.aborted
      ? await Ludusavi.getBackupPreview(
          game.shop,
          game.objectId,
          context?.winePrefixPath ?? game.winePrefixPath,
          AbortSignal.any([signal, AbortSignal.timeout(5_000)])
        ).catch(() => null)
      : null;
  const games = preview?.games ?? {};
  // Some manifest entries are returned under the official title rather than the requested ID.
  const matches = Object.values(games);
  const match =
    games[game.objectId] ?? (matches.length === 1 ? matches[0] : null);
  const legacyResult = await parseFiles(Object.keys(match?.files ?? {}));
  return legacyResult.status === "not-found" ? nativeResult : legacyResult;
}
