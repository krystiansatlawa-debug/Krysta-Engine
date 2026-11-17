# Achievement detection: shared file observations and retry behavior

Krysta Launcher **does not unlock official Steam, Epic or Ubisoft achievements on their services**. It reads achievement evidence exposed by supported games, emulator formats and connected services, syncs supported unlocked records to Hydra, and shows them in the UI.

Previously the local file watcher stored timestamps by absolute file path only. Two game entries pointing to the same file could suppress each other's notifications. FLT folders could also be skipped on their first scan. The observer now tracks each game's state independently, records both file modification time and size, observes folder changes, and forgets a game's changed-file state when merging fails so a later poll can retry.

The repair **does not** add unsupported formats, infer unlocks without evidence, guarantee parity between separate Steam/Epic editions, or bypass official platform APIs. Troubleshooting requires a concrete game, platform, source/edition, achievement name, game activity, and available log; never invent or force achievements.

Regression tests:
`node --import ./scripts/register-ts-node.mjs --test src/main/services/achievements/achievement-file-observation-tracker.test.ts`
