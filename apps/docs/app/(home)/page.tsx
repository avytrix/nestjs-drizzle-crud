import { TopBanner } from "@/components/home/top-banner";
import { HeroTagChips } from "@/components/home/hero-tag-chips";
import { HeroCtaPills } from "@/components/home/hero-cta-pills";
import { QuickConfigSnippet } from "@/components/home/quick-config-snippet";
import { FeatureGrid } from "@/components/home/feature-grid";
import { CompatibleWith } from "@/components/home/compatible-with";
import { LatestReleases } from "@/components/home/latest-releases";
import { SponsorCta } from "@/components/home/sponsor-cta";
import { Footer } from "@/components/home/footer";

export default function HomePage() {
	return (
		<>
			<TopBanner />

			<section className="container mx-auto max-w-6xl px-6 pt-16 pb-12 md:pt-20 md:pb-16">
				<div className="flex max-w-3xl flex-col items-start gap-5">
					<h1 className="text-4xl font-bold leading-[1.1] tracking-[-0.48px] text-fd-foreground sm:text-5xl md:text-6xl">
						Type-safe CRUD for Drizzle ORM in NestJS.
					</h1>
					<p className="text-lg leading-relaxed text-fd-muted-foreground md:text-xl">
						Configure the connection once in{" "}
						<code className="rounded-[2px] bg-[var(--fd-surface-muted)] px-1.5 py-0.5 font-mono text-base text-fd-foreground">
							AppModule
						</code>
						. Every entity gets the full CRUD surface, type-safe,
						dialect-aware, and ready to extend.
					</p>
					<HeroTagChips />
					<HeroCtaPills />
				</div>
			</section>

			<section className="container mx-auto max-w-6xl px-6 pb-20">
				<QuickConfigSnippet />
			</section>

			<section className="container mx-auto max-w-6xl px-6 pb-20">
				<h2 className="mb-6 text-[24px] font-bold leading-[1.5] tracking-[-0.48px] text-[var(--fd-heading-color)] md:text-[32px]">
					What you get
				</h2>
				<FeatureGrid />
			</section>

			<section className="container mx-auto max-w-6xl px-6 pb-20">
				<h2 className="mb-6 text-[24px] font-bold leading-[1.5] tracking-[-0.48px] text-[var(--fd-heading-color)] md:text-[32px]">
					Compatible with
				</h2>
				<CompatibleWith />
			</section>

			<section className="container mx-auto max-w-6xl px-6 pb-20">
				<h2 className="mb-6 text-[24px] font-bold leading-[1.5] tracking-[-0.48px] text-[var(--fd-heading-color)] md:text-[32px]">
					Latest releases
				</h2>
				<LatestReleases />
			</section>

			<section className="container mx-auto max-w-6xl px-6 pb-20">
				<SponsorCta />
			</section>

			<Footer />
		</>
	);
}
