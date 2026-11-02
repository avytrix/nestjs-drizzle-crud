import { Controller } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createCrudController } from "@avytrix/nestjs-drizzle-crud";
import { projects } from "../db/schema";
// Value imports: the factory hands the DTO classes to ValidationPipe.
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { projectsCrud } from "./projects.crud";
import { ProjectsService } from "./projects.service";

// Every route comes from the factory: list (offset and ?cursor=), trash, get,
// create, update, delete (a soft delete here), soft-delete, restore and the
// four bulk routes, turned on below. The id pipe follows the serial key.
@ApiTags("projects")
@Controller("projects")
export class ProjectsController extends createCrudController(ProjectsService, {
	dto: { create: CreateProjectDto, update: UpdateProjectDto },
	// The bulk bodies get the same checks as the global pipe in main.ts.
	validation: { whitelist: true },
	deleteMode: "soft",
	routes: {
		bulkCreate: true,
		bulkUpdate: true,
		bulkDelete: true,
		bulkRestore: true,
	},
	openapi: { table: projects, ...projectsCrud },
}) {}
