# nestjs-drizzle-crud docs

Documentation site for [`nestjs-drizzle-crud@3.3.0`](https://www.npmjs.com/package/nestjs-drizzle-crud).
Next.js 16 + Fumadocs, **static-exported** (`output: "export"`) and deployed to
**GitHub Pages** via `.github/workflows/deploy-docs.yml` on push to `main`.
Lives at `apps/docs/` in the `nestjs-drizzle-crud` monorepo (pnpm workspace + Turborepo).

Repo-wide rules are in the root [`AGENTS.md`](../../AGENTS.md), including the
mandatory changelog, humanize, and SEO/AEO passes that apply to every page here.
This file adds the rules specific to the docs site.

## Layout

```
app/                       App Router (Next.js 16)
  layout.tsx               RootProvider + Inter
  (home)/                  Marketing home, wrapped in <HomeLayout {...baseOptions()}>
  docs/                    /docs/[[...slug]] via DocsLayout
  api/search/              Orama server route
  sitemap.ts, robots.ts    metadata routes
  icon.tsx, opengraph-image.tsx  next/og ImageResponse
  global.css               tokens, fence accents, iOS safe-area, nav overrides
components/home/           8 home components (banner, hero chips/ctas, prerequisites,
                           feature grid, compatible-with, latest-releases, footer)
content/docs/              4 route-group sections: (getting-started), (configuration),
                           (guides), (reference). Add a page = .mdx + meta.json entry.
lib/                       source.ts (loader), layout.shared.tsx (baseOptions),
                           seo.ts (siteConfig: version + URLs)
source.config.ts           defineDocs + Shiki + custom `accent-meta` transformer
next.config.mjs            createMDX() + serverExternalPackages: [typescript, twoslash]
```

## Content policy

1. **Docs mirror package version exactly.** On each release, in order: bump
   `lib/seo.ts::siteConfig.version`, sweep page-level version refs, update
   `content/docs/(reference)/changelog.mdx` (mirrors upstream `CHANGELOG.md`),
   update `components/home/latest-releases.tsx` snapshot.
2. **Feature pages describe current behavior only.** Historical record lives in
   `/docs/changelog`.
3. **Cross-link instead of duplicating.**

## Code-fence accent convention

Append `accent=nest` or `accent=drizzle` to ```ts fence meta:

| Tag | Use for |
|-----|---------|
| `accent=nest` | NestJS wiring, `app.module.ts`, `*.controller.ts`, providers |
| `accent=drizzle` | Drizzle schema definitions, raw SQL |
| (untagged) | Library API, mixed code, npm/shell, no accent |

The tag lands on the rendered `<figure>` wrapper (not `<pre>`. Fumadocs wraps
Shiki in a `<figure>`). CSS in `app/global.css:35-40` turns `data-accent` into
a 3 px inset box-shadow on the left edge.

## Design language (Drizzle-style, non-negotiable)

- Default corner radius: `rounded-[2px]` everywhere.
- **Two 8 px exceptions only:** `hero-cta-pills` and `latest-releases` cards.
- Hairline borders: `1px solid var(--fd-border-muted)`.
- Heading tracking: `-0.48px` on h1 and section h2s.
- Primary red (`--color-fd-primary` = `#E0234E`) for links, accents, NestJS fences.
- Secondary green (`--color-fd-drizzle` = `#C5F74F`) sparingly. Pill CTAs, OG accent.

Do not add `rounded-md/lg/xl` outside the two allowed exceptions.

## Nav structure

`app/(home)/layout.tsx` wraps the home in `<HomeLayout {...baseOptions()}>`, which
auto-injects `<header id="nd-nav">` (logo + Documentation + Changelog + GitHub +
Cmd+K search + theme toggle + mobile drawer). **Never add a second `<header>`.**
Customize via `lib/layout.shared.tsx::baseOptions()` (`links`, `nav`, `githubUrl`).

Auto-injected search chip and theme toggle default to `rounded-full`. Override
to 2 px in `app/global.css:45-50`:

```css
#nd-nav nav [data-search-full] { border-radius: 2px; }
#nd-nav nav button[aria-label="Toggle Theme"] { border-radius: 2px; }
```

## Scripts & deploy

```bash
pnpm --filter nestjs-drizzle-crud-docs typecheck   # runs fumadocs-mdx first
pnpm --filter nestjs-drizzle-crud-docs build       # next build → static export in out/
pnpm dev                                          # :3000 (root `dev` runs this app)
```

Deploy is automatic: pushing to `main` runs `.github/workflows/deploy-docs.yml`,
which builds the library first (Twoslash needs its types), exports the site, and
publishes `apps/docs/out` to GitHub Pages. There is no manual deploy command and
no Vercel project. The workflow copies the root `CNAME` into the output and adds
`.nojekyll`, so the site serves at [crud.avytrix.dev](https://crud.avytrix.dev).

Env: `NEXT_PUBLIC_SITE_URL` (consumed by `lib/seo.ts`, `app/sitemap.ts`,
`app/robots.ts`, `app/layout.tsx`); the workflow sets it from `CNAME`.
`NEXT_PUBLIC_BASE_PATH` stays empty because the custom domain serves at root;
set it to the repo name only if the site moves to a `github.io/<repo>/` URL.

## Gotchas

1. `lib/source.ts:1` uses **relative** `../.source/server` import, not `@/.source/server`. Turbopack quirk.
2. `useTheme` lives at `fumadocs-ui/provider/base`, NOT `fumadocs-core/utils/use-theme`.
3. `.source/` is auto-generated, gitignored. Never edit.
4. `NEXT_PUBLIC_SITE_URL` must be set at build time for absolute sitemap/robots URLs; the deploy workflow derives it from `CNAME`.
5. `serverExternalPackages: ["typescript", "twoslash"]` is required for Twoslash bundling.
6. Tailwind v4 reads `--color-fd-*` / `--fd-*` via inline `var(...)`. No `tailwind.config.*` file exists.
7. The `accent-meta` Shiki transformer is structurally typed (no `@shikijs/types` import. Transitive dep).

## Responsive

Mobile-first. Tap targets ≥ 44 px on `<md` (WCAG AA AAA). iOS safe-area-inset
already wired on `<body>` (`app/global.css:60-62`). Grids collapse at `md:` / `lg:`.
Banner uses `truncate` for narrow viewports. Hide secondary nav links on `<md`;
hero CTAs carry mobile navigation.

## Commit style

One commit per logical change. `<type>(<scope>): <imperative summary>`.
Observed types: `feat(home)`, `style`, `doc(<version>)`, `chore`.

```
3637e9a feat(home): Drizzle-style redesign — sharp corners, top banner, anchor cards
82246a0 chore: drop 'by Suman Bonakurthi' attribution from footer
ddfa298 style: responsive polish — hero, footer tap targets, tablet grids
d3f8c6b doc(3.0.3): update docs for 3.0.3 + 3.0.x deltas
4f37988 Re-brand: NestJS red primary, Drizzle green secondary
7b79ff8 Initial commit: nestjs-drizzle-crud docs site
```

## Single sources of truth

| Value | File |
|-------|------|
| Documented package version | `lib/seo.ts::siteConfig.version` |
| Site / GitHub / npm URLs | `lib/seo.ts::siteConfig` |
| Nav structure | `lib/layout.shared.tsx::baseOptions()` |
| Release history | `content/docs/(reference)/changelog.mdx` |
| Latest releases shown on home | `components/home/latest-releases.tsx` |
| Color tokens | `app/global.css:6-29` |
| Avytrix Technologies mark (header, favicon source, sharing card) | `public/avytrix-icon.png`; favicons in `app/icon.png`, `app/apple-icon.png` |

## What this site does NOT do

No auth · no DB · no API beyond `/api/search` · no test suite · no i18n. CI does
cover this app: the root Biome lint includes its files, and `pnpm typecheck` and
`pnpm build` run it through Turbo. What it has no job for is tests.
