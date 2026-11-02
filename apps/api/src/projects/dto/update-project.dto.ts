import {
	IsInt,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from "class-validator";

export class UpdateProjectDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(255)
	name?: string;

	// The version the client last read. A stale one answers 409.
	@IsOptional()
	@IsInt()
	version?: number;
}
