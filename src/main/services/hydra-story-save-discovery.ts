import type { CloudSavePathContext, Game } from "@types";
import { parseRecompilationCloudSaveObjectId } from "@shared";
import { getCloudSavePathContext } from "./cloud-save/cloud-save-game-context";
import { cloudSaveCustomPathContextFromPathContext } from "./cloud-save/custom-path";
import { getCloudSaveCustomPathRules } from "./cloud-save/custom-path-store";
import {
  discoverEmulatorSaveFiles,
  getEmulatorSaveProvider,
} from "./cloud-save/emulator-save-provider";
import { getRecompilationSaveRules } from "./cloud-save/recompilation-cloud-save";
import { Ludusavi } from "./ludusavi";
import { NativeAddon } from "./native-addon";
import { SystemPath } from "./system-path";
import {
  readDiscoveredStorySave,
  type StorySaveScan,
  type StorySaveSource,
} from "./story-progress-save";

async function nativeSaveFiles(
  game: Game,
  context: CloudSavePathContext,
  recompilationRules: ReturnType<typeof getRecompilationSaveRules>,
  canRead: () => boolean
) {
  const [manifestRules, customRules] = await Promise.all([
    NativeAddon.getSaveRulesForGame({
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
      remoteId: game.remoteId ?? undefined,
      userDataPath: SystemPath.getPath("userData"),
      recompilationRules,
    })
      .then(({ rules }) =>
        rules.filter(
          ({ tags }) => !tags.includes("config") || tags.includes("save")
        )
      )
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
  source: StorySaveSource | undefined,
  canRead: () => boolean,
  signal: AbortSignal
): Promise<StorySaveScan> {
  const context = canRead()
    ? await getCloudSavePathContext(game.objectId, game.shop).catch(
        () => undefined
      )
    : undefined;
  const parseFiles = (detectedFiles: string[]) =>
    readDiscoveredStorySave(detectedFiles, source, canRead);

  const recompilationRules = context
    ? getRecompilationSaveRules(
        context.pathContext,
        context.game?.executablePath
      )
    : undefined;
  const port = parseRecompilationCloudSaveObjectId(game.shop, game.objectId);
  const provider = port ? null : getEmulatorSaveProvider(game);
  let emulatorFiles: string[] = [];
  if (provider && canRead()) {
    emulatorFiles = await (async () => {
      if (provider === "retroarch") {
        const { listRetroArchSavePaths } = await import(
          "./cloud-save/retroarch-save-provider"
        );
        return listRetroArchSavePaths(game, canRead);
      }
      const { discovery } = await discoverEmulatorSaveFiles(game, "");
      return discovery.files.map(({ absolutePath }) => absolutePath);
    })().catch(() => []);
  }

  const native =
    context && canRead() && (!provider || emulatorFiles.length === 0)
      ? await nativeSaveFiles(
          game,
          context.pathContext,
          recompilationRules,
          canRead
        ).catch(() => [])
      : [];
  const nativeResult = await parseFiles([...emulatorFiles, ...native]);
  if (
    provider ||
    port ||
    nativeResult.status === "ready" ||
    nativeResult.status === "waiting" ||
    (!source && nativeResult.status === "save-found")
  )
    return nativeResult;

  const preview =
    canRead() && !signal.aborted
      ? await Ludusavi.getBackupPreview(
          game.shop,
          game.objectId,
          context?.pathContext.winePrefixPath ?? game.winePrefixPath,
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
