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

	// `?onlyDeleted=true` is the trash view, `?withDeleted=true` lists both.
	// parseQuery only accepts them because of allowTrash.
	@Get()
	findAll(@Query() query: Record<string, unknown>) {
		const q = this.tags.parseQuery(query, { allowTrash: true });
		return this.tags.findAll(q.filters, q.pagination, q.options);
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

	// Hard-deletes every id, in the trash or not, in one statement.
	@Post("purge")
	@HttpCode(200)
	purgeMany(@Body() dto: BulkDeleteTagsDto) {
		return this.tags.massForceDelete(dto.ids);
	}

	// Moves a tag to the trash (soft delete).
	@Post(":id/archive")
	@HttpCode(200)
	archive(@Param("id", ParseUUIDPipe) id: string) {
		return this.tags.softDelete(id);
	}

	@Post(":id/restore")
	@HttpCode(200)
	restore(@Param("id", ParseUUIDPipe) id: string) {
		return this.tags.restore(id);
	}

	// Hard delete, whether the tag is in the trash or not.
	@Delete(":id/purge")
	purge(@Param("id", ParseUUIDPipe) id: string) {
		return this.tags.forceDelete(id);
	}

	@Delete(":id")
	remove(@Param("id", ParseUUIDPipe) id: string) {
		return this.tags.delete(id);
	}
}
