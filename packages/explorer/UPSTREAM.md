# Upstream source

This package is a copy of the Understand Anything dashboard, which is licensed under the MIT License (see `LICENSE.upstream`, the upstream root `LICENSE`, unchanged).

- Source repository: https://github.com/Egonex-AI/Understand-Anything (the `repository.url` of the upstream plugin `package.json`)
- Commit: `b8c807c632743ab695ec43cb654a0f1efe216bc8`
- Dashboard path in the upstream repository: `understand-anything-plugin/packages/dashboard`
- Core path in the upstream repository: `understand-anything-plugin/packages/core`

## Copied files

Copied byte for byte in the first commit of this package, with no edit of any kind:

- `understand-anything-plugin/packages/dashboard/src/**` to `src/**` (every file, including each `__tests__` directory);
- `understand-anything-plugin/packages/dashboard/index.html` to `index.html`;
- `understand-anything-plugin/packages/core/src/types.ts` to `src/core/types.ts`;
- `understand-anything-plugin/packages/core/src/schema.ts` to `src/core/schema.ts`;
- `understand-anything-plugin/packages/core/src/search.ts` to `src/core/search.ts`;
- `LICENSE` (repository root) to `LICENSE.upstream`.

The three core modules are the ones the dashboard imports as `@understand-anything/core/types`, `@understand-anything/core/schema` and `@understand-anything/core/search`; they import only `zod`, `fuse.js` and each other, so nothing else of the core package is copied. The alias in `vite.config.ts` and `tsconfig.json` maps those imports to `src/core/*`, so the copied files keep their upstream import lines.

Not copied: the dashboard's `public/` directory, `scripts/`, `vite.config.ts`, `vite.config.demo.ts`, `tsconfig*.json` and `package.json` (this package writes its own config files), and the core package's tests.

## Files added by this package

`package.json`, `tsconfig.json`, `vite.config.ts` and `UPSTREAM.md` are not upstream files. Every later commit in this package carries our own edits to the copied files, so `git log -p` on a copied path shows exactly what differs from the upstream commit above.

## Full list of copied paths

All paths below are relative to this package directory.

- `LICENSE.upstream`
- `index.html`
- `src/App.tsx`
- `src/__tests__/allNodeTypes.test.ts`
- `src/__tests__/edgeCategories.test.ts`
- `src/__tests__/freshness.test.ts`
- `src/__tests__/locales.test.ts`
- `src/__tests__/store-navigation.test.ts`
- `src/__tests__/vite-staleness.test.ts`
- `src/components/Breadcrumb.tsx`
- `src/components/CodeViewer.tsx`
- `src/components/ContainerNode.tsx`
- `src/components/CustomNode.tsx`
- `src/components/DiffToggle.tsx`
- `src/components/DomainClusterNode.tsx`
- `src/components/DomainGraphView.tsx`
- `src/components/ExportMenu.tsx`
- `src/components/FileExplorer.tsx`
- `src/components/FilterPanel.tsx`
- `src/components/FlowNode.tsx`
- `src/components/GraphView.tsx`
- `src/components/KeyboardShortcutsHelp.tsx`
- `src/components/KnowledgeGraphView.tsx`
- `src/components/LayerClusterNode.tsx`
- `src/components/LayerLegend.tsx`
- `src/components/LearnPanel.tsx`
- `src/components/MobileBottomNav.tsx`
- `src/components/MobileDrawer.tsx`
- `src/components/MobileLayout.tsx`
- `src/components/NodeInfo.tsx`
- `src/components/NodeTooltip.tsx`
- `src/components/OnboardingOverlay.tsx`
- `src/components/PathFinderModal.tsx`
- `src/components/PersonaSelector.tsx`
- `src/components/PortalNode.tsx`
- `src/components/ProjectOverview.tsx`
- `src/components/SearchBar.tsx`
- `src/components/StalenessBanner.tsx`
- `src/components/StepNode.tsx`
- `src/components/ThemePicker.tsx`
- `src/components/TokenGate.tsx`
- `src/components/WarningBanner.tsx`
- `src/components/__tests__/StalenessBanner.test.ts`
- `src/components/__tests__/structuralVisibleTypes.test.ts`
- `src/contexts/I18nContext.tsx`
- `src/core/schema.ts`
- `src/core/search.ts`
- `src/core/types.ts`
- `src/freshness.ts`
- `src/hooks/useIsMobile.ts`
- `src/hooks/useKeyboardShortcuts.ts`
- `src/index.css`
- `src/locales/en.ts`
- `src/locales/index.ts`
- `src/locales/ja.ts`
- `src/locales/ko.ts`
- `src/locales/ru.ts`
- `src/locales/vi.ts`
- `src/locales/zh-TW.ts`
- `src/locales/zh.ts`
- `src/main.tsx`
- `src/store.ts`
- `src/themes/ThemeContext.tsx`
- `src/themes/index.ts`
- `src/themes/presets.ts`
- `src/themes/theme-engine.ts`
- `src/themes/types.ts`
- `src/utils/__tests__/containers.test.ts`
- `src/utils/__tests__/edgeAggregation.test.ts`
- `src/utils/__tests__/elk-layout.test.ts`
- `src/utils/__tests__/filters.test.ts`
- `src/utils/__tests__/force-layout-client.test.ts`
- `src/utils/__tests__/force-layout.test.ts`
- `src/utils/__tests__/layerStats.test.ts`
- `src/utils/__tests__/smoke.test.ts`
- `src/utils/containers.ts`
- `src/utils/edgeAggregation.ts`
- `src/utils/elk-layout.ts`
- `src/utils/filters.ts`
- `src/utils/force-layout-client.ts`
- `src/utils/force-layout.ts`
- `src/utils/force-layout.worker.ts`
- `src/utils/layerStats.ts`
- `src/utils/layout.ts`
- `src/utils/layout.worker.ts`
- `src/utils/louvain.ts`
- `src/vite-env.d.ts`
