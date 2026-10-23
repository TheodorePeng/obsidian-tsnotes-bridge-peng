# Resource import and library layout (Bridge 0.1.15)

Compatible release set: TSNotes 0.8.14, NotionImporter 0.4.0, Bridge 0.1.15. Playback protocol remains 1.2; resource support is advertised separately as `resource-import-v1`.

## Directory responsibilities

```text
TSNotes/
  Videos.base
  Playlists.base
  Videos/_records/<video>.md
  Playlists/_records/<playlist>.md
  Playlists/_records/Playlist Videos.base
  Resources/<video TSNotesID>/<title> - 字幕.<language>.md
  Resources/<video TSNotesID>/<title> - AI 笔记.md
  Resources/<video TSNotesID>/assets/<sha256>.<extension>
  _data/README.md
  _data/playlists/<playlist UUID>.json
```

Resource folders are created only for actual imports. Main videos remain unique across Playlists. `_data/playlists` is authoritative relationship data and must be backed up with the Vault. The shared Playlist Base uses `this.TSNotesID` from its embedding Playlist; opening it by itself is not the same context.

The two root Bases filter identity Properties, not the initial file path. Moving a record elsewhere does not remove its identity. Initialization preserves customized existing views. The default new Videos Base includes resource links; existing views are not automatically rewritten.

## Entry-file migration

Run **Preview library entry layout migration** (the plugin command with ID `preview-library-layout`). Review paths and conflicts, then confirm the displayed plan. Only the two overview Bases and guide move; video and Playlist records and relationship JSON stay in place. Native Obsidian rename updates links. The guide moves first so subsequent native link changes do not invalidate a pending source hash. Existing guide text is retained and a marked v3 layout section is appended.

Existing legacy entries defer creation of competing new entries. Until migration, overview commands can open the old location. Target collisions and changed/unsaved files stop migration. Backups and the step journal live on the device under `Application Support/TSNotes Bridge Peng/layout-migrations/<Vault ID>/<operation ID>/journal.json`. It contains original bytes, the confirmed plan and completed destinations. It is not synced with the Vault.

If interrupted, do not blindly repeat or overwrite a target: inspect the journal and current hashes. Recovery of an entry migration is currently a guided operation, not an automatic resume/rollback command. Restore only unchanged task outputs and check for edits or new links first. Keep all journals until acceptance. This differs from the older full-library migration commands.

## Resource fields

| Property | Meaning |
| --- | --- |
| ResourceID | Independent resource UUID, stable on update and rename |
| TSNotes Parent ID | Main video UUID |
| Resource Type | `subtitle` or `ai-notes` |
| Language | Normalized subtitle language, unknown `und` |
| Video | Internal link back to the main note |
| Imported time / Updated time | Import and update timestamps |
| Source Hash | Stable generated content hash, excluding collection timestamps and temporary image URLs |
| Imported Body Hash | Last generated body hash; detects personal edits |

Resources do not receive `TSNotesID` or `Record Type: video`. Dedupe is parent UUID + resource type + language. MetadataCache and file events maintain the resource index. The main note receives only `Subtitles` and `AI Notes` link-list Properties; its personal body is never a remote write target. Renaming a parent or resource repairs managed links without moving files back.

## Import and update

1. In NotionImporter, connect TSNotes and explicitly approve the requesting extension on the TSNotes bridge page.
2. Refresh Vaults and choose the target. This selection is independent of TSNotes Save destination.
3. Import subtitles, native Baidu AI notes, or all supported resources for the current site.
4. Existing resources are skipped. Use the separate update preview, inspect old/new text, then confirm.

An update requires both the current full-file hash and the last generated body to match. Personal body edits stop updates; there is no force overwrite. Unknown Properties, resource UUID and creation time survive. Updates back up old content locally. If a resource was written but main-note linking failed, it remains intact; retry repairs the link rather than creating another resource. Opening failure is reported separately from writing.

Subtitle timestamps use the existing TSNotes URL syntax. AI images must download successfully and are embedded from local assets with checksum-based names. Image failure fails that AI resource; successful subtitles remain. No AI model is invoked. Neither ordinary TSNotes Save nor resource import requires a VideoPlay connection.

## Restricted transport and recovery

Only TSNotes holds pairing secrets. Approved cross-extension messages carry explicit Vault IDs and limited resource operations. The Bridge chooses paths; clients cannot submit arbitrary paths or main-note bodies. Loopback requests retain the 1 MiB limit; parts use 128 KiB chunks and SHA-256 checks. Import creates no permanent socket or background polling.

Incomplete uploads expire after ten minutes and are cleaned on a later begin. Interrupted browser jobs require an explicit retry; committed identities are checked first. Update backups and staging journals live under device-local `resource-imports/<Vault ID>`. Cancelling stops later submissions and does not delete committed resources. Do not delete personal files or identity conflicts to make a retry pass.

Deployment replaces only runtime artifacts. Preserve `data.json`, pairing secrets, browser-instance bindings and presentation settings. Restoring artifacts does not require deleting imported resources. See the dated acceptance record for actual runtime coverage and backup locations.
