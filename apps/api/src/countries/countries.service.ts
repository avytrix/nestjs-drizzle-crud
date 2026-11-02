import { type CrudFilter, SqlBaseCrudService } from "@avytrix/nestjs-drizzle-crud";
import type { countries } from "../db/schema";
import type { CreateCountryDto } from "./dto/create-country.dto";
import type { UpdateCountryDto } from "./dto/update-country.dto";

export type Country = typeof countries.$inferSelect;

// Empty by design: all behavior comes from SqlBaseCrudService. Override the
// protected hooks here (validateCreate, beforeCreate, ...) for custom logic.
export class CountriesService extends SqlBaseCrudService<
	Country,
	CreateCountryDto,
	UpdateCountryDto,
	CrudFilter
> {}
