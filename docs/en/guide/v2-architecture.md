# Voyager V2 Architecture

Voyager V2 is M365-first while retaining separate Gemini and AI Studio compatibility entry points. Chrome, Edge, and Firefox are supported.

- Each platform has an independent content script and feature lifecycle.
- `gvSettingsV2` stores small synchronized settings; `gvWorkspaceV2` stores local folders, prompts, stars, references, and tombstones.
- V2 never reads or deletes legacy keys.
- M365 snapshots are serializable; live DOM anchors are held separately and pruned when virtualized nodes disconnect.
- VoyagerDock uses Shadow DOM and the M365 Popup is loaded independently from the legacy Google UI.
- External storage, imports, OAuth responses, and cloud files are validated with Zod.

See [OneDrive V2 setup](./onedrive-v2) and [V2 testing](./testing-v2).
