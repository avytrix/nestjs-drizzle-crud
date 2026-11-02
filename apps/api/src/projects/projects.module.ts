import {
	type MiddlewareConsumer,
	Module,
	type NestModule,
} from "@nestjs/common";
import { CrudContext, DrizzleCrudModule } from "@avytrix/nestjs-drizzle-crud";
import { projects } from "../db/schema";
import { ProjectsController } from "./projects.controller";
import { projectsCrud } from "./projects.crud";
import { ProjectsService } from "./projects.service";

// A real app reads the tenant from the authenticated user. The example reads
// a header so the e2e suite can switch tenants. No header means no tenant,
// and the scope answers 403 instead of running unscoped.
function tenantOf(request: { headers: Record<string, unknown> }) {
	const raw = Number(request.headers["x-tenant-id"]);
	return Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

@Module({
	imports: [
		DrizzleCrudModule.forFeature([
			{ service: ProjectsService, table: projects, config: projectsCrud },
		]),
	],
	controllers: [ProjectsController],
})
export class ProjectsModule implements NestModule {
	configure(consumer: MiddlewareConsumer) {
		consumer
			.apply(CrudContext.middleware((req) => ({ tenantId: tenantOf(req) })))
			.forRoutes(ProjectsController);
	}
}
