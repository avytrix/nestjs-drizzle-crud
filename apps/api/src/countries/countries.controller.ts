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
// Value imports (not `import type`): NestJS DI and ValidationPipe read the
// runtime class from emitDecoratorMetadata; type-only imports would erase them.
import { CountriesService } from "./countries.service";
import { CreateCountryDto } from "./dto/create-country.dto";
import { QueryCountryDto } from "./dto/query-country.dto";
import { UpdateCountryDto } from "./dto/update-country.dto";

// `?withRegion=true&withStates=true` -> ['region', 'states']
function relationsOf(withRegion?: string, withStates?: string): string[] {
	const relations: string[] = [];
	if (withRegion === "true") relations.push("region");
	if (withStates === "true") relations.push("states");
	return relations;
}

@Controller("countries")
export class CountriesController {
	constructor(private readonly countries: CountriesService) {}

	@Get()
	findAll(@Query() query: QueryCountryDto) {
		const {
			page,
			limit,
			sortBy,
			sortOrder,
			search,
			withRegion,
			withStates,
			fields,
			stateName,
			...filters
		} = query;
		return this.countries.findAll(
			{ ...filters, ...(stateName ? { states: { name: stateName } } : {}) },
			{ page, limit, sortBy, sortOrder },
			{
				relations: relationsOf(withRegion, withStates),
				select: fields ? fields.split(",") : undefined,
				search: search
					? { term: search, columns: ["name", "code"] }
					: undefined,
			},
		);
	}

	@Get(":id")
	async find(
		@Param("id", ParseIntPipe) id: number,
		@Query("withRegion") withRegion?: string,
		@Query("withStates") withStates?: string,
	) {
		const country = await this.countries.find(id, {
			relations: relationsOf(withRegion, withStates),
		});
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
