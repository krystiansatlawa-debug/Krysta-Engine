# Krysta 1.0.24 – Achievements 2.0

- Improved local achievement discovery, parsing and recovery.
- Active-game scanning during Game Boost, offline synchronization retries and deduplication.
- Historical unlocks no longer trigger fresh capture outside the recent-unlock window.
- Local scan history and remotely updated Steam identity aliases.
- Initial opt-in backup export to a synchronized folder via KRYSTA_BACKUP_FOLDER.

Limitations: backup restore and folder selection UI are not yet implemented; scan history UI and comprehensive platform coverage remain future work. Google Drive connection overhaul is planned separately.


## Cloud Sync 2.0

- Improved Google Drive authorization, connection checks and token refresh.
- Save discovery, version history, conflict checks, offline queue and compression.
- Per-game manual synchronization, operation status and Polish diagnostics.
- Backup configuration overview and optional Google media backups.

Metadata backup and recovery features remain limited; live provider compatibility requires verification.
