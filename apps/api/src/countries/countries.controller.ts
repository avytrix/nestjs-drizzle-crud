import {
	Body,
	Controller,
	Delete,
	Get,
	NotFoundException,
	Param,
	ParseIntPipe,
	Patch,
	Post,
	Query,
} from "@nestjs/common";
import { ApiCrudList } from "@avytrix/nestjs-drizzle-crud";
import { countries } from "../db/schema";
// Value imports (not `import type`): NestJS DI and ValidationPipe read the
// runtime class from emitDecoratorMetadata; type-only imports would erase them.
import { countriesCrud } from "./countries.crud";
import { CountriesService } from "./countries.service";
import { CreateCountryDto } from "./dto/create-country.dto";
import { UpdateCountryDto } from "./dto/update-country.dto";

@Controller("countries")
export class CountriesController {
	constructor(private readonly countries: CountriesService) {}

	// The whole query string goes through parseQuery, which coerces values by
	// column type and checks them against the allowlists in countries.module.ts:
	//   ?region[name]=Asia&name[startsWith]=In&sortBy=-name&page=2&limit=10
	//   ?or[0][code]=IN&or[1][code]=NP&with=region,states&fields=id,name
	//   ?states[name]=Kerala&search=nep
	//   ?states[none][name]=Kerala&counts=states,tags&withCount=false
	// `?cursor=` (empty for the first page) switches to keyset pagination.
	// ApiCrudList documents every one of those parameters in /docs.
	@Get()
	@ApiCrudList({ table: countries, ...countriesCrud })
	findAll(@Query() query: Record<string, unknown>) {
		const q = this.countries.parseQuery(query);
		return q.isCursor
			? this.countries.findByCursor(q.filters, q.pagination, q.options)
			: this.countries.findAll(q.filters, q.pagination, q.options);
	}

	@Get(":id")
	async find(
		@Param("id", ParseIntPipe) id: number,
		@Query("with") withParam?: string,
		@Query("fields") fields?: string,
	) {
		const { options } = this.countries.parseQuery({
			with: withParam,
			fields,
		});
		const country = await this.countries.find(id, options);
		if (!country) {
			throw new NotFoundException(`Country ${id} not found`);
		}
		return country;
	}

	@Post()
	create(@Body() dto: CreateCountryDto) {
		return this.countries.create(dto);
	}

	@Patch(":id")
	update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateCountryDto) {
		return this.countries.update(id, dto);
	}

	@Delete(":id")
	remove(@Param("id", ParseIntPipe) id: number) {
		return this.countries.delete(id);
	}
}
