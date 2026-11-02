import { type CrudFilter, SqlBaseCrudService } from "nestjs-drizzle-crud";
import type { tags } from "../db/schema";
import type { CreateTagDto } from "./dto/create-tag.dto";

export type Tag = typeof tags.$inferSelect;

// Demonstrates a uuid primary key and soft delete (trash, restore, purge).
export class TagsService extends SqlBaseCrudService<
	Tag,
	CreateTagDto,
	CreateTagDto,
	CrudFilter
> {}
