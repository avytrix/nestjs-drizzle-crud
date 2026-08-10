import { Module } from "@nestjs/common";
import { DrizzleCrudModule } from "nestjs-drizzle-crud";
import { countries, regions, states } from "../db/schema";
import { CountriesController } from "./countries.controller";
import { CountriesService } from "./countries.service";

@Module({
	imports: [
		DrizzleCrudModule.forFeature([
			{
				service: CountriesService,
				table: countries,
				config: {
					primaryKey: "id",
					primaryKeyType: "serial",
					relations: {
						// belongs-to: countries.region_id -> regions.id
						region: { table: regions, localKey: "region_id" },
						// has-many: states.country_id -> countries.id
						states: {
							table: states,
							type: "hasMany",
							foreignKey: "country_id",
						},
					},
					defaultSort: [{ column: "name", order: "asc" }],
				},
			},
		]),
	],
	controllers: [CountriesController],
})
export class CountriesModule {}
