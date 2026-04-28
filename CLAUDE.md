# CLAUDE.md - Gemini Voyager

## Commands

Windows 本地开发优先使用 `npm.cmd`：

```powershell
npm.cmd install --package-lock=false --legacy-peer-deps
npm.cmd run dev:chrome
npm.cmd run build:chrome
npm.cmd run test
npm.cmd run typecheck
npm.cmd exec -- eslint .
npm.cmd exec -- prettier --check .
```

历史 Bun/WSL 命令仍可作为旧环境参考：

```bash
bun install                # Setup
bun run dev:chrome         # Dev (also: dev:firefox, dev:safari)
bun run build:chrome       # Build (also: build:firefox, build:safari, build:edge, build:all)
bun run test               # Test (also: test:watch, test:ui, test:coverage)
bun run typecheck          # Type check
bun run lint               # Lint
bun run format             # Format
bun run bump               # Version bump (patch)
bun run docs:dev           # Docs dev server
```

## Core Rules

1. **No `any` type.** Use `unknown` + narrowing. Use Branded Types for IDs.
2. **No direct `chrome.storage` in UI components.** Use `StorageService`. Content scripts (`src/pages/content/`) are an exception — they use `chrome.storage` directly via ExtGlobal.
3. **No `console.log` in production.** Use `LoggerService`.
4. **No global variables** outside defined Services.
5. **No magic strings.** Use constants/enums for Storage Keys and CSS Classes.
6. **All CSS classes injected into Gemini DOM must be prefixed `gv-`.**
7. **All translations must be updated in all 10 locales** (`en`, `ar`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`, `zh`, `zh_TW`) when adding/modifying i18n keys.
8. **Never modify `dist_*` folders directly.**
9. **Never commit `.env` or secrets.**
10. **When adding Material Symbol icons**, add the icon name to `icon_names=` in the Google Fonts URL in `src/pages/popup/index.html`.
11. **User-facing replies default to Chinese.** Plans / `proposed_plan` content may be written in English.

## Verification (run before declaring done)

1. `npm.cmd run typecheck` — after any `.ts`/`.tsx` change
2. `npm.cmd exec -- eslint .` — before finishing
3. `npm.cmd run test` — all tests pass
4. `npm.cmd run build:chrome` — builds without error
5. New features/fixes must include tests

## Commit Format

Conventional Commits: `<type>(<scope>): <imperative summary>`

- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`, `perf`, `style`
- Scope: short, feature-focused (e.g., `copy`, `export`, `popup`)
- Summary: lowercase, imperative, no trailing period
- If the commit relates to a GitHub issue or discussion, include `Closes #xxx` or `Fixes #xxx` in the commit **body**

## Version Bump & Release

```bash
bun run bump    # auto-updates package.json, manifest.json, manifest.dev.json
```

**Changelog required:** after bumping, ensure `src/pages/content/changelog/notes/` has a `.md` file for the new version before pushing. Do not skip this step.

Then: commit `chore: bump to v{VERSION}` → `git tag v{VERSION}` → `git push && git push --tags`

## Design Principles

1. **KISS.** Implement the minimum interpretation of requirements. Never combine orthogonal features (e.g., "fade" and "thin") without explicit confirmation.
2. **Backward compatibility is iron law.** Zero destructiveness to user data (especially `localStorage`).
3. **Data structures first.** Eliminate special cases by redesigning data, not adding branches.
4. **For visual/CSS changes:** describe expected rendering, verify alignment/centering/spacing in both light and dark themes, and check external resources (icon fonts, CDN links).
5. **For ambiguous requirements:** implement the minimal version first. Ask before adding scope.

## Architecture

- **Services**: singletons in `src/core/services/`. `StorageService` is single source of truth for persistence.
- **Content scripts**: `src/pages/content/`. Each sub-module is self-contained.
- **UI**: functional React components + hooks. Business logic in `features/*/services/` or custom hooks, not in UI files.
- **Types**: `src/core/types/common.ts` for StorageKeys and shared types.
- **Translations**: `src/locales/*/messages.json` (10 languages).
- **Injected CSS**: `public/contentStyle.css`.

- **M365 Copilot 迁移上下文：** 修改 `src/pages/content/m365*` 或 M365 manifest matches 前，先阅读 `M365_COPILOT_CONTEXT.md`。当 selectors、浏览器测试流程或 extractor output 变化时，同步更新该文档。
- **Windows M365 验证：** 重新 `build:chrome` 后，需要在 `edge://extensions/` reload `L:\project\dist_chrome`，再刷新 M365 页面；否则 Edge 可能继续使用旧 manifest 中的旧 content script 路径。
- **用户沟通语言：** 面向用户的最终回复和过程更新默认使用中文；plan / proposed_plan 可以使用英文。

## Task Map

| Task | Where |
|------|-------|
| Add storage key | `src/core/types/common.ts` → `StorageService.ts` → all 10 locales |
| Update translations | `src/locales/*/messages.json` (all 10) |
| Change DOM injection | `src/pages/content/` |
| Modify popup settings | `src/pages/popup/components/` |
| Fix cloud sync | `src/core/services/GoogleDriveSyncService.ts` |
| Add keyboard shortcut | `src/core/services/KeyboardShortcutService.ts` + types |
