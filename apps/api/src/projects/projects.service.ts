import { type CrudFilter, SqlBaseCrudService } from "nestjs-drizzle-crud";
import type { projects } from "../db/schema";
import type { CreateProjectDto } from "./dto/create-project.dto";
import type { UpdateProjectDto } from "./dto/update-project.dto";

export type Project = typeof projects.$inferSelect;

export class ProjectsService extends SqlBaseCrudService<
	Project,
	CreateProjectDto,
	UpdateProjectDto,
	CrudFilter
> {}
