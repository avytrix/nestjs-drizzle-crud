const STEPS = [
	{
		n: 1,
		title: "Configure once in AppModule",
		code: `DrizzleCrudModule.forRoot({
  dialect: 'postgresql',
  connectionString: process.env.DATABASE_URL,
  schema,
});`,
	},
	{
		n: 2,
		title: "A service is an empty subclass",
		code: `export class UsersService extends SqlBaseCrudService<User> {}`,
	},
	{
		n: 3,
		title: "Bind it to its table",
		code: `DrizzleCrudModule.forFeature([
  { service: UsersService, table: users },
]);`,
	},
];

export function QuickConfigSnippet() {
	return (
		<div className="rounded-lg border border-[var(--fd-border-muted)] bg-[var(--fd-surface-muted)] p-5">
			<div className="mb-4 text-sm font-semibold text-fd-foreground">
				Prerequisites
			</div>
			<ol className="space-y-4">
				{STEPS.map((s) => (
					<li key={s.n} className="flex items-start gap-3">
						<span className="flex size-5 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-fd-primary)]/15 text-[var(--color-fd-primary)] text-xs font-bold">
							{s.n}
						</span>
						<div className="min-w-0 flex-1">
							<div className="mb-1.5 text-sm font-medium text-fd-foreground">
								{s.title}
							</div>
							<pre className="overflow-x-auto rounded-lg bg-fd-background p-3 font-mono text-xs leading-relaxed">
								<code className="text-fd-foreground/90">{s.code}</code>
							</pre>
						</div>
					</li>
				))}
			</ol>
			<p className="mt-4 text-center text-sm text-fd-muted-foreground">
				That&apos;s it. <code className="font-mono">UsersService</code> now has{" "}
				<code className="font-mono">find</code>,{" "}
				<code className="font-mono">create</code>,{" "}
				<code className="font-mono">update</code>,{" "}
				<code className="font-mono">delete</code>, soft delete, restore, bulk
				ops, filtering, pagination, and full-text search.
			</p>
		</div>
	);
}
