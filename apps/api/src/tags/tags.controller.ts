import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
} from "@nestjs/common";
// Value imports (not `import type`): NestJS DI and ValidationPipe read the
// runtime class from emitDecoratorMetadata; type-only imports would erase them.
import { BulkDeleteTagsDto } from "./dto/bulk-delete-tags.dto";
import { CreateTagDto } from "./dto/create-tag.dto";
import { TagsService } from "./tags.service";

@Controller("tags")
export class TagsController {
	constructor(private readonly tags: TagsService) {}

	@Get()
	findAll(@Query("page") page?: string, @Query("limit") limit?: string) {
		return this.tags.findAll(
			{},
			{
				page: page ? Number(page) : undefined,
				limit: limit ? Number(limit) : undefined,
			},
		);
	}

	@Get(":id")
	async find(@Param("id", ParseUUIDPipe) id: string) {
		const tag = await this.tags.find(id);
		if (!tag) {
			throw new NotFoundException(`Tag ${id} not found`);
		}
		return tag;
	}

	@Post()
	create(@Body() dto: CreateTagDto) {
		return this.tags.create(dto);
	}

	// Deletes every id or none. A failure answers 400 with one entry per failed
	// id in `errors`, each carrying the status that id alone would have produced.
	@Post("bulk-delete")
	@HttpCode(200)
	removeMany(@Body() dto: BulkDeleteTagsDto) {
		return this.tags.massDelete(dto.ids);
	}

	@Delete(":id")
	remove(@Param("id", ParseUUIDPipe) id: string) {
		return this.tags.delete(id);
	}
}
