# StatsEdge Design Rules

Use this file as the visual contract for StatsEdge UI work.

## Product Feel

- Build a professional research terminal, not a marketing site.
- The screener, filters, table, charts, and evidence are the product.
- Keep density high, hierarchy clear, and visual noise low.
- Prefer restrained, technical UI over decorative SaaS patterns.

## Hard Rules

- Do not create a landing page unless explicitly requested.
- Do not add hero sections, decorative gradients, blobs, illustrations, or ornamental cards.
- Do not put cards inside cards.
- Do not change the palette or typography unless the task is explicitly a design-system pass.
- Do not redesign unrelated surfaces while working on a scoped feature.
- Do not touch scoring, filters, or data logic during visual-only work unless explicitly requested.

## Layout Rules

- Keep the table and chart workflow central.
- Keep filters compact, grouped, and progressively disclosed.
- Use accordions or details panels for advanced controls.
- Every numeric filter should have its own enable control and editable threshold.
- Preserve the threshold value when a filter is disabled.
- Use concise labels that name the metric, not long explanatory text.

## Metrics Hierarchy

Default table columns should stay close to:

```text
Ticker | Chart | Price | Stage | RS | RS Grupo | Setup | Demand | Risk | Composite
```

Advanced metrics belong in row details, hover panels, modals, CSV, or advanced filter groups.

## Brand And Legal Language

- Use `StatsEdge` as the product name; keep code renames deliberate.
- Avoid product labels based on third-party names or brands.
- Prefer labels such as `Stage 2`, `Trend Template`, `RS Leadership`, `Demand`, `Risk`, and `Deterioration`.
- If external investors/authors are mentioned, do it only in methodology docs with a clear no-affiliation disclaimer.
