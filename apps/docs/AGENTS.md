# nestjs-drizzle-crud docs

Documentation site for [`nestjs-drizzle-crud`](https://www.npmjs.com/package/nestjs-drizzle-crud)
(version: `lib/seo.ts::siteConfig.version`). Next.js 16 + Fumadocs, **static-exported**
(`output: "export"`) and deployed to **GitHub Pages** via `.github/workflows/deploy-docs.yml`
on push to `main`. Lives at `apps/docs/` in the `nestjs-drizzle-crud` monorepo (pnpm workspace +
Turborepo).

Repo-wide rules are in the root [`AGENTS.md`](../../AGENTS.md), including the
mandatory changelog, humanize, and SEO/AEO passes that apply to every page here.
This file adds the rules specific to the docs site.

## Layout

```
app/                       App Router (Next.js 16)
  layout.tsx               Geist fonts + <Provider> (RootProvider with the custom search dialog)
  (home)/                  Home page, wrapped in <HomeLayout {...baseOptions()}> + home JSON-LD
  docs/                    /docs/[[...slug]] inside <DocsShell> (notebook layout, nav mode "top")
  api/search/              Static Orama index for Cmd+K
  llms.txt, llms-full.txt  Answer-engine map, and every page as Markdown in one file
  llms.mdx/docs/           One page as Markdown: /llms.mdx/docs/<slug>/content.md
  og/docs/                 Per-page sharing card: /og/docs/<slug>/image.png
  opengraph-image.tsx      Site-wide sharing card (same renderer, lib/og.tsx)
  not-found.tsx            The 404 GitHub Pages serves
  sitemap.ts, robots.ts    Metadata routes; sitemap lastmod comes from git
  global.css               The theme (tokens, prose rhythm, dark code blocks, assistant motion)
components/
  docs-shell.tsx           Notebook DocsLayout + sponsor card + assistant panel
  docs-sidebar.tsx         Sidebar slot with the icon rail shown when collapsed
  search.tsx, provider.tsx Cmd+K dialog (useStaticSearch) and the root provider
  mdx.tsx                  The MDX component registry (see below)
  assistant/               "Ask the docs" panel and its state hook
  home/                    Home page sections
lib/
  seo.ts                   siteConfig (version, URLs, brand, git paths) + createMetadata
  source.ts                Loader, lucide icon resolver, llms helpers, markdown/OG URL builders
  structured-data.ts       One JSON-LD @graph per page (Organization, WebSite, SoftwareSourceCode,
                           WebPage, TechArticle, BreadcrumbList)
  page-tree.ts             firstUrl / pageUrls / folderPath helpers
  doc-history.ts           Last-modified dates and recent doc commits from git
  og.tsx                   Sharing card renderer (Avytrix mark + "Nestjs Drizzle")
  assistant/               Retrieval, answer composition, small talk, session, Web Worker
scripts/                   Search index build / verify / eval (chunk.mjs is shared)
public/search-index.json   Committed embedding index for the assistant
content/docs/              Route-group sections. Add a page = .mdx + meta.json entry.
```

## MDX components

Everything below is registered in `components/mdx.tsx` and usable from any page without an import:

| Component | Use |
| --- | --- |
| `Tabs` / `Tab` | `<Tabs items={["a","b"]}><Tab value="a">…</Tab></Tabs>`. Also what ```` ```npm ```` fences compile to. |
| `Callout` | `<Callout type="info\|warn\|error" title="…">…</Callout>` |
| `Cards` / `Card` | `<Card icon={<Rocket />} title="…" href="/docs/…">…</Card>` |
| `Steps` / `Step` | Wrap each step (heading + body) in `<Step>`; the number comes from `Step`. |
| `Accordions` / `Accordion` | `<Accordion title="…">…</Accordion>`. Content stays in the HTML. |
| `PropsTable` | `props={{ name: { type, required, default, description } }}`, flat, no disclosure. |
| `Banner` | Fumadocs banner. |
| `InstallTabs` | `<InstallTabs pkg="postgres" dev />`; `pkg` defaults to this package. pnpm/npm/yarn/bun. |
| `RunTabs` | `<RunTabs command="nestjs-drizzle-crud-mcp" />` (dlx / npx / bunx). |
| `DocsChangelog` | Recent commits to `content/docs`, from git. Used on the changelog page. |
| `Ext` / `Url` | `<Ext to="npm">…</Ext>`, `<Url to="github" />`. Keys: docs, github, issues, npm, sponsor, avytrix. |
| `Version` | The documented version from `siteConfig.version`. Never hardcode a version in prose. |
| Lucide icons | `Rocket`, `Database`, `Layers`, `Shield`, … (the list in `mdx.tsx`). Add a name there to use a new one. |

Frontmatter `icon: <LucideName>` shows in the sidebar and next to the page title; `meta.json`
takes `icon` for a section and `"---Label---"` entries for sidebar separators. An unknown icon
name fails the build.

## Content policy

1. **Docs mirror package version exactly.** On each release, in order: bump
   `lib/seo.ts::siteConfig.version`, sweep page-level version refs, update
   `content/docs/(reference)/changelog.mdx` (mirrors upstream `CHANGELOG.md`),
   update `components/home/latest-releases.tsx` snapshot.
2. **Feature pages describe current behavior only.** Historical record lives in
   `/docs/changelog`.
3. **Cross-link instead of duplicating.**
4. **Refresh the search index after content changes** (`search:index`, see README). The build
   warns when it is stale and still deploys.

## Code-fence accent convention

Append `accent=nest` or `accent=drizzle` to ```ts fence meta:

| Tag | Use for |
|-----|---------|
| `accent=nest` | NestJS wiring, `app.module.ts`, `*.controller.ts`, providers |
| `accent=drizzle` | Drizzle schema definitions, raw SQL |
| (untagged) | Library API, mixed code, npm/shell, no accent |

The `accent-meta` transformer in `source.config.ts` puts `data-accent` on the rendered
`<figure>`, and `app/global.css` turns it into a 3 px inset bar on the left edge.

## Design language

- Tokens live in `app/global.css`: primary `#2552FF` (lifted in dark mode), cool black
  `#0B0D12` dark background, muted text darkened to clear WCAG AA on tinted surfaces.
- Geist for text, Geist Mono for code and data.
- Prose rhythm: body leading 1.7, headings 1.25, a 72ch measure, extra space above h2/h3.
- Code blocks are dark in both themes.
- Fumadocs' own radii (`rounded-lg` / `rounded-xl`); no hand-rolled corner scale.
- The home page reads `--fd-surface-muted`, `--fd-border-muted`, `--fd-heading-color`,
  `--fd-pill-bg`, which alias the Fumadocs tokens. Use the Fumadocs tokens in new code.

## Nav structure

`lib/layout.shared.tsx::baseOptions()` is the single header config for both layouts: logo
(Avytrix mark + `siteConfig.displayName`), Documentation, Changelog, npm, and icon links for
Sponsor and Avytrix Technologies, plus GitHub. **Never add a second `<header>`.** The docs use
the notebook layout with `nav.mode: "top"`; spread `baseOptions()` first, then override `nav`,
or the mode is silently lost.

## Search

- **Cmd+K**: Fumadocs static search over `/api/search` (Orama index generated at build).
- **Ask the docs**: `components/assistant/` + `lib/assistant/`. A Web Worker loads
  `@huggingface/transformers` 4.3.1 from jsDelivr (pinned, `TRANSFORMERS_URL` in `worker.ts`),
  downloads `Xenova/all-MiniLM-L6-v2` from the Hugging Face hub on the first question, and ranks
  the sections in `public/search-index.json`. No server, no key. Answers are quoted from the
  docs, never generated.
- `@huggingface/transformers` is **not** a workspace dependency: adding it makes pnpm re-check
  `semver@6.3.1`, which the workspace `trustPolicy` refuses. Do not loosen the policy to add it.

## Scripts & deploy

```bash
pnpm --filter nestjs-drizzle-crud-docs typecheck   # runs fumadocs-mdx first
pnpm --filter nestjs-drizzle-crud-docs build       # verify search index, next build --webpack, out/
pnpm --filter nestjs-drizzle-crud-docs search:index  # needs TRANSFORMERS_MODULE, see README
pnpm dev                                          # :3000 (root `dev` runs this app)
```

The build uses webpack, not Turbopack: Turbopack emits the assistant's `new Worker(new URL(...))`
as a raw `.ts` asset instead of compiling it.

Deploy is automatic: pushing to `main` runs `.github/workflows/deploy-docs.yml`, which checks out
full history (page dates and the docs changelog come from git), builds the library first
(Twoslash needs its types), exports the site, and publishes `apps/docs/out` to GitHub Pages. The
workflow copies the root `CNAME` into the output and adds `.nojekyll`, so the site serves at
[crud.avytrix.dev](https://crud.avytrix.dev).

Env: `NEXT_PUBLIC_SITE_URL` (consumed by `lib/seo.ts` and everything built on `siteConfig.url`);
the workflow sets it from `CNAME`. `NEXT_PUBLIC_BASE_PATH` stays empty because the custom domain
serves at root.

## Gotchas

1. `lib/source.ts` uses a **relative** `../.source/server` import, not `@/.source/server`.
2. `fumadocs-ui` is the `@fumadocs/base-ui` build, aliased. Import paths stay `fumadocs-ui/...`.
3. lucide-react 1.x has no brand icons; GitHub is `components/github-mark.tsx`.
4. `.source/` is auto-generated, gitignored. Never edit.
5. `serverExternalPackages: ["typescript", "twoslash"]` is required for Twoslash bundling.
6. Tailwind v4 reads `--color-fd-*` / `--fd-*` via inline `var(...)`. No `tailwind.config.*` file exists.
7. `public/search-index.json` is excluded from Biome so a format run does not pretty-print it.
8. Scripts under `scripts/` are plain `.mjs` because `next build` runs the verify step on Node 20,
   which cannot strip TypeScript types.

## Responsive

Mobile-first. Tap targets ≥ 44 px on `<md`. iOS safe-area insets are on `<body>` in
`app/global.css`. Grids collapse at `md:` / `lg:`. The assistant opens as a full-height sheet
below `sm` and never opens by itself there.

## Single sources of truth

| Value | File |
|-------|------|
| Documented package version | `lib/seo.ts::siteConfig.version` |
| Site / GitHub / npm / org URLs, git paths | `lib/seo.ts::siteConfig` |
| Nav structure | `lib/layout.shared.tsx::baseOptions()` |
| Release history | `content/docs/(reference)/changelog.mdx` |
| Latest releases shown on home | `components/home/latest-releases.tsx` |
| Color and type tokens | `app/global.css` |
| MDX components | `components/mdx.tsx` |
| Avytrix Technologies mark (header, favicon source, sharing cards) | `public/avytrix-icon.png`; favicons in `app/icon.png`, `app/apple-icon.png` |

## What this site does NOT do

No auth · no DB · no server (static export) · no test suite · no i18n. CI does cover this app:
the root Biome lint includes its files, and `pnpm typecheck` and `pnpm build` run it through
Turbo.
