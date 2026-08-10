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

// `?with=region,states,states.cities,tags` -> the eager-load list. Dotted paths
// load a relation of a relation. Unknown names are ignored by the service.
function relationsOf(withParam?: string): string[] {
	return (withParam ?? "")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
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
			with: withParam,
			fields,
			stateName,
			tagName,
			...filters
		} = query;
		return this.countries.findAll(
			{
				...filters,
				// filter by a related collection: countries that have a state / tag
				...(stateName ? { states: { name: stateName } } : {}),
				...(tagName ? { tags: { name: tagName } } : {}),
			},
			{ page, limit, sortBy, sortOrder },
			{
				relations: relationsOf(withParam),
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
		@Query("with") withParam?: string,
		@Query("fields") fields?: string,
	) {
		const country = await this.countries.find(id, {
			relations: relationsOf(withParam),
			select: fields ? fields.split(",") : undefined,
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
