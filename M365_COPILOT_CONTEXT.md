# M365 Copilot Migration Architecture Baseline

Last updated: 2026-04-26
Status: active M365 adapter baseline
Target site: `https://m365.cloud.microsoft/*`

This is the handoff document for future Codex sessions. Read it before changing M365-specific code.

## Current Completed Capabilities

- The extension injects on `m365.cloud.microsoft` through `manifest.json`.
- `src/pages/content/index.tsx` isolates M365 from Gemini features: on `location.hostname === 'm365.cloud.microsoft'`, it starts only diagnostics and the M365 chat extractor, then returns.
- Manual diagnostics are available through `window.__gvDiagRun()`, `window.__gvDiagClear()`, and `window.__gvLastDiagResult`.
- Manual extraction is available through `window.__gvExtract()` for the compatibility result and `window.__gvExtractCanonical()` for the canonical model.
- Real Edge/CDP testing confirmed content script APIs live in the isolated execution context named `Voyager`.
- Real M365 DOM evidence from 2026-04-26 showed `20` raw user nodes, `40` raw assistant nodes, `10` article nodes, and `10` logical messages.
- Automated tests cover duplicate user prevention, empty user filtering, duplicate assistant prevention, assistant multi-part ordering, and compatibility facade output.

## Migration Goals

The M365 adapter is migrating three Gemini Voyager capabilities, but they must share one M365-native conversation index:

- Conversation export: JSON, Markdown, PDF, and Image output.
- Timeline navigation: marker/index generation and scroll navigation.
- Wider conversation layout: M365 page-width enhancement.

Do not directly copy Gemini DOM selectors. Do not let export, timeline, and chatWidth each scan the M365 DOM independently.

## Module Boundaries

Canonical conversation data is the required boundary between M365 DOM probing and future user-facing features.

Current code:

- `src/pages/content/m365ConversationTypes.ts`
  Defines `CanonicalConversation`, `CanonicalMessage`, raw candidate types, message roles, and content items.
- `src/pages/content/m365ConversationExtractor.ts`
  `M365ConversationExtractor` only reads the M365 DOM and returns raw message candidates.
- `src/pages/content/m365CanonicalConversation.ts`
  `CanonicalConversationBuilder` only sorts, filters, dedupes, normalizes text, creates fingerprints, creates stable ids, and computes counts.
- `src/pages/content/m365ChatExtractor.ts`
  Compatibility facade for debug APIs. It delegates to `M365ConversationExtractor` and `CanonicalConversationBuilder`.
- `src/pages/content/m365FeatureServices.ts`
  Reserved service boundary for future `M365ExportService`, `M365TimelineService`, and `M365LayoutEnhancer`; these consume `CanonicalConversation` instead of scanning DOM.
- `src/pages/content/m365Diagnostics.ts`
  Temporary diagnostics only. It must not become business logic.

Future rule:

- ExportService consumes `CanonicalConversation` and adapts it to existing export formats.
- TimelineService consumes `CanonicalMessage` and builds navigation indexes.
- LayoutEnhancer only changes layout/CSS. If it needs message anchors, it reads `CanonicalMessage.sourceElement`.

## Message Extraction Baseline

Known M365 message classes:

```text
fai-UserMessage
fai-CopilotMessage
```

Logical message roots are `role="article"` nodes. Raw M365 class matches may be nested or repeated inside one article, so the extractor normalizes class matches to the nearest logical article root.

User recognition:

- Prefer `[class*="fai-UserMessage"]`.
- Normalize raw matches to closest `[role="article"]`.
- Prefer body root `[class*="fai-UserMessage__message"]`.
- Strip leading `You said:`.
- Drop empty user placeholders after cleanup.

Assistant recognition:

- Prefer `[class*="fai-CopilotMessage"]`.
- Normalize raw matches to closest `[role="article"]`.
- Prefer body root `[class*="fai-CopilotMessage__content"]`.
- Exclude buttons, toolbars, accessible headings, avatar/name/disclaimer chrome, chain-of-thought UI, and feedback UI.

Deduplication and ids:

- Empty text-only messages are dropped unless they include images.
- Adjacent duplicate logical messages are removed by fingerprint.
- Fingerprint format is `role + normalized lowercase text + image keys`.
- Message id format is `m365:<index>:<fingerprintHash>`.
- These ids are stable for repeated extraction of the same rendered page state. They are not a permanent cross-session or edited-message database id.

## Migration Routes

Conversation export route:

- Add M365 export UI only after CanonicalConversation output is stable on more real conversations.
- Convert `CanonicalMessage` into existing export turns without direct M365 DOM scanning.
- Preserve JSON and Markdown first; PDF/Image should reuse the existing export services once rich content handling is validated.

Timeline route:

- Build timeline markers from `CanonicalMessage` order and `sourceElement`.
- Start with user-message markers only if needed for parity, but the source remains canonical messages, not M365 selectors.
- Keep star/timestamp persistence separate from DOM selector details.

Wider UI route:

- Implement `M365LayoutEnhancer` as CSS/layout logic only.
- Do not read message text or rescan message DOM inside layout code.
- Use canonical source elements only for anchoring if necessary.

## Real Browser Testing Workflow

Edge did not reliably load the unpacked extension directly from the WSL UNC path:

```text
\\wsl.localhost\Ubuntu\home\xiaoyanjie\projects\gemini-voyager\dist_chrome
```

Working approach:

1. Build in WSL.
2. Copy `dist_chrome` to a Windows-local temporary directory.
3. Launch Edge with `--load-extension=<windows-local-dist>` and a fresh profile.
4. Use CDP and evaluate in the `Voyager` isolated world.

Example PowerShell:

```powershell
$src='\\wsl.localhost\Ubuntu\home\xiaoyanjie\projects\gemini-voyager\dist_chrome'
$dst="$env:TEMP\gemini-voyager-dist-chrome"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
Copy-Item -Recurse -Force $src $dst

$profile="$env:TEMP\gemini-voyager-m365-profile"
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$edge='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$args=@(
  '--remote-debugging-port=9225',
  "--user-data-dir=$profile",
  "--disable-extensions-except=$dst",
  "--load-extension=$dst",
  '--no-first-run',
  '--no-default-browser-check',
  'https://m365.cloud.microsoft/chat'
)
Start-Process -FilePath $edge -ArgumentList $args
```

CDP rule:

- Enumerate `Runtime.executionContextCreated`.
- Select context `name === "Voyager"`.
- Call `window.__gvExtract()` or `window.__gvExtractCanonical()` there.

## Test Strategy

Primary commands:

```bash
/home/xiaoyanjie/.bun/bin/bun run test src/pages/content/m365ChatExtractor.test.ts
/home/xiaoyanjie/.bun/bin/bun run typecheck
/home/xiaoyanjie/.bun/bin/bunx eslint src/pages/content/m365*.ts src/pages/content/m365*.test.ts
/home/xiaoyanjie/.bun/bin/bunx prettier --check src/pages/content/m365*.ts src/pages/content/m365*.test.ts
/home/xiaoyanjie/.bun/bin/bun run build:chrome
```

Required regression coverage:

- No duplicate user messages from nested M365 nodes.
- No empty `You said:` user placeholders.
- No duplicate assistant snapshots.
- Multi-part assistant content is stable in canonical order.
- `CanonicalConversation.totalMessages` matches the real logical message count, not raw class-node count.
- Legacy `extractM365Messages()` stays backed by canonical output.

## Known Gaps

- Real M365 image-message DOM still needs capture and validation.
- Code blocks, tables, links, and rich Markdown fidelity are not yet modeled beyond flattened text plus images.
- Conversation loading can lag behind URL changes; future UI entrypoints need wait/retry around `[role="article"]`.
- Sidebar/conversation traversal remains deferred.
- Diagnostics markers such as `gv-m365-diag-marker` must not affect extraction.

## Milestones

1. Stabilize CanonicalConversation on more real M365 conversations, including image/code/table examples.
2. Add a read-only export adapter from CanonicalConversation to existing export service inputs.
3. Add timeline marker generation from CanonicalMessage without new DOM selectors.
4. Add M365 layout enhancer using CSS and canonical anchors only when necessary.
5. Gate or remove diagnostics before production release.

## Update Protocol

Update this file whenever any of these change:

- M365 DOM selectors.
- CanonicalConversation or CanonicalMessage shape.
- Extractor output shape.
- Real browser testing workflow.
- Real-world DOM evidence.
- Current priority or deferred scope.
- M365-related files.
- Commands required to test/build.

When updating:

1. Change `Last updated`.
2. Revise the relevant section instead of appending scattered notes.
3. Include exact class/role evidence for selector changes.
4. Treat this document as the source of truth for future Codex sessions.
