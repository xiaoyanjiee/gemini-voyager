# OneDrive V2 Setup

Register a single-page application in Microsoft Entra, add only delegated `Files.ReadWrite.AppFolder`, and do not create a client secret. Supply the application ID through `VITE_ONEDRIVE_CLIENT_ID`.

Run `chrome.identity.getRedirectURL('onedrive')` in each browser build and register every returned URI. Store and development extension IDs may require separate URIs.

Voyager uses authorization code + PKCE, stores access tokens only in `storage.session`, and writes `voyager-workspace-v2.json` under `/me/drive/special/approot`. It does not request or persist refresh tokens.

Switching the primary cloud always requires an explicit merge, local-overwrite, or remote-replace choice. Only folders, prompts, and starred records are synchronized.
