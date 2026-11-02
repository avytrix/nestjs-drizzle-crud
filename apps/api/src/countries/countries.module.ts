import { Module } from "@nestjs/common";
import { DrizzleCrudModule } from "nestjs-drizzle-crud";
import { countries } from "../db/schema";
import { CountriesController } from "./countries.controller";
import { countriesCrud } from "./countries.crud";
import { CountriesService } from "./countries.service";

@Module({
	imports: [
		DrizzleCrudModule.forFeature([
			{
				service: CountriesService,
				table: countries,
				config: countriesCrud,
			},
		]),
	],
	controllers: [CountriesController],
})
export class CountriesModule {}
