import { ArrayNotEmpty, IsArray, IsUUID } from "class-validator";

export class BulkDeleteTagsDto {
	@IsArray()
	@ArrayNotEmpty()
	@IsUUID("all", { each: true })
	ids!: string[];
}
