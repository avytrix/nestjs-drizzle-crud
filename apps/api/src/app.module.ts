import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DrizzleCrudModule } from "nestjs-drizzle-crud";
import { CountriesModule } from "./countries/countries.module";
import { createPgliteDb, isPglite } from "./db/pglite";
import * as schema from "./db/schema";
import { TagsModule } from "./tags/tags.module";

@Module({
	imports: [
		ConfigModule.forRoot({ isGlobal: true }),
		// Configure the connection once. The tables have no soft-delete column,
		// so disable it globally; created_at/updated_at exist, so keep timestamps.
		DrizzleCrudModule.forRootAsync({
			useFactory: async () => {
				const connectionString = process.env.DATABASE_URL;
				if (!connectionString) {
					throw new Error("DATABASE_URL is not set");
				}
				const defaults = { softDelete: false, timestamps: true };
				// `DATABASE_URL=pglite` runs against an in-process Postgres (PGlite),
				// seeded with the e2e fixture. Anything else is a real server.
				if (isPglite(connectionString)) {
					return {
						dialect: "postgresql" as const,
						db: await createPgliteDb(),
						defaults,
					};
				}
				return {
					dialect: "postgresql" as const,
					connectionString,
					schema,
					defaults,
				};
			},
		}),
		CountriesModule,
		TagsModule,
	],
})
export class AppModule {}
