/**
 * The npm wordmark, inline, for the same reason as the GitHub mark. `currentColor`, so it follows
 * the theme. Fumadocs squares every link icon (`[&_svg]:size-4`), so the size here is `!`.
 */
export function NpmMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 780 250"
			fill="currentColor"
			aria-hidden="true"
			className={`h-3.5! w-11! ${className ?? ""}`}
		>
			<path d="M240 250h100v-50h100V0H240zm100-200h50v100h-50zM480 0v200h100V50h50v150h50V50h50v150h50V0zM0 200h100V50h50v150h50V0H0z" />
		</svg>
	);
}
