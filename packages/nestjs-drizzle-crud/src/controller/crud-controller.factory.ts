import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Inject,
	NotFoundException,
	Param,
	ParseArrayPipe,
	ParseIntPipe,
	ParseUUIDPipe,
	Patch,
	type PipeTransform,
	Post,
	Query,
	type Type,
	ValidationPipe,
	type ValidationPipeOptions,
} from "@nestjs/common";
import type { SqlBaseCrudService } from "../core/abstract/sql-base-crud.service";
import type { ParseCrudQueryOptions } from "../core/interfaces/query.interface";
import type { SqlOperationOptions } from "../core/interfaces/sql-crud-config.interface";
import { EntityNotFoundException } from "../exceptions/crud.exceptions";
import {
	ApiCrudList,
	type ApiCrudSource,
} from "../openapi/api-crud.decorators";

// The routes createCrudController can register, with their method and path:
//
//   list            GET    /                 offset, or keyset with ?cursor=
//   trash           GET    /trash            soft-deleted rows only
//   get             GET    /:id
//   create          POST   /
//   update          PATCH  /:id
//   delete          DELETE /:id              see `deleteMode`
//   softDelete      POST   /:id/soft-delete
//   restore         POST   /:id/restore
//   bulkCreate      POST   /bulk             body: an array of create DTOs
//   bulkUpdate      PATCH  /bulk             body: { ids, data }
//   bulkDelete      POST   /bulk-delete      body: { ids }
//   bulkRestore     POST   /bulk-restore     body: { ids }
export type CrudRouteName =
	| "list"
	| "trash"
	| "get"
	| "create"
	| "update"
	| "delete"
	| "softDelete"
	| "restore"
	| "bulkCreate"
	| "bulkUpdate"
	| "bulkDelete"
	| "bulkRestore";

export interface CrudRouteOptions {
	/** Register the route. Every route except the bulk ones is on by default. */
	enabled?: boolean;
	/** Decorators for this route only: guards, interceptors, Swagger, roles. */
	decorators?: MethodDecorator[];
}

export interface CrudControllerOptions {
	/** Apply `@Controller(path)` to the generated class. Leave it out to decorate a subclass yourself. */
	path?: string;
	/**
	 * How to parse `:id`. Unset, it follows the primary key column at request
	 * time: ParseIntPipe for an integer, ParseUUIDPipe for a uuid, the string
	 * as is otherwise.
	 */
	idType?: "int" | "uuid" | "string";
	/** DTO classes, so a global ValidationPipe validates the bodies. */
	dto?: { create?: Type<unknown>; update?: Type<unknown> };
	/**
	 * Validator options for the bulk bodies, which a global ValidationPipe
	 * cannot see into (an array, and `data` inside `{ ids, data }`). Pass the
	 * same options as your global pipe, such as `{ whitelist: true }`.
	 */
	validation?: ValidationPipeOptions;
	/** Options for parseQuery on list and trash (allowTrash, ignore, ...). */
	query?: ParseCrudQueryOptions;
	/** Turn routes on or off, or give one its own decorators. */
	routes?: Partial<Record<CrudRouteName, boolean | CrudRouteOptions>>;
	/** Decorators applied to every route, before the per-route ones. */
	decorators?: MethodDecorator[];
	/** Class decorators for the generated controller (`ApiTags`, `UseGuards`, ...). */
	classDecorators?: ClassDecorator[];
	/**
	 * What `DELETE /:id` and `POST /bulk-delete` do: "hard" (the default)
	 * deletes the row, "soft" moves it to the trash.
	 */
	deleteMode?: "hard" | "soft";
	/**
	 * Document the list and trash routes with ApiCrudList. Pass the entity
	 * (table, relations, allowlists) or `true` for a service decorated with
	 * @CrudService. Needs `@nestjs/swagger`.
	 */
	openapi?: true | ApiCrudSource;
}

// The instance a generated controller has: the service, plus the handlers.
export interface CrudControllerInstance<S> {
	readonly service: S;
}

const BULK_ROUTES = new Set<CrudRouteName>([
	"bulkCreate",
	"bulkUpdate",
	"bulkDelete",
	"bulkRestore",
]);

interface IdsBody {
	ids?: unknown;
}

// Validates `data` of a `{ ids, data }` bulk update body against the update
// DTO, the check a single PATCH gets from the global ValidationPipe.
class BulkUpdateBodyPipe implements PipeTransform {
	private readonly pipe: ValidationPipe;

	constructor(
		private readonly dto: Type<unknown>,
		options?: ValidationPipeOptions,
	) {
		this.pipe = new ValidationPipe(options);
	}

	async transform(body: { ids?: unknown; data?: unknown } | undefined) {
		if (!body?.data || typeof body.data !== "object") return body;
		const data = await this.pipe.transform(body.data, {
			type: "body",
			metatype: this.dto,
		});
		return { ...body, data };
	}
}

// The ids of a bulk body, each parsed like a `:id` param, so a bad one is a
// 400 before any statement runs instead of a failed batch that is replayed.
async function idsOf(
	service: { parseId(raw: unknown): Promise<unknown> },
	body: IdsBody | undefined,
): Promise<unknown[]> {
	const ids = body?.ids;
	if (!Array.isArray(ids) || ids.length === 0) {
		throw new BadRequestException("ids must be a non-empty array");
	}
	return Promise.all(ids.map((id) => service.parseId(id)));
}

// Build a CRUD controller for a service. Use it as a base class, so you can
// add routes and decorators of your own:
//
//   @Controller("authors")
//   export class AuthorsController extends createCrudController(
//     AuthorsService,
//     { dto: { create: CreateAuthorDto, update: UpdateAuthorDto } },
//   ) {}
//
// Every route goes through the service, so allowlists, scope, soft delete,
// optimistic locking and events apply exactly as they do in code.
export function createCrudController<
	S extends SqlBaseCrudService<any, any, any, any>,
>(
	service: Type<S>,
	options: CrudControllerOptions = {},
): Type<CrudControllerInstance<S>> {
	const routeOptions = (name: CrudRouteName): CrudRouteOptions | undefined => {
		const value = options.routes?.[name];
		const enabled =
			typeof value === "boolean"
				? value
				: (value?.enabled ?? !BULK_ROUTES.has(name));
		if (!enabled) return undefined;
		return typeof value === "object" ? value : {};
	};
	const idPipe =
		options.idType === "int"
			? ParseIntPipe
			: options.idType === "uuid"
				? ParseUUIDPipe
				: undefined;
	const queryOptions = options.query ?? {};

	// The options a route's `?with=`, `?fields=` and `?counts=` give, without
	// treating anything else in the query as a filter.
	const readOptions = (
		svc: S,
		query: Record<string, unknown> | undefined,
	): SqlOperationOptions => {
		const picked: Record<string, unknown> = {};
		for (const key of ["with", "fields", "counts"]) {
			if (query?.[key] !== undefined) picked[key] = query[key];
		}
		return svc.parseQuery(picked, queryOptions).options;
	};

	const softDeleteOn = (svc: S) => {
		const softDelete = (svc as any).config?.softDelete;
		if (!softDelete?.enabled) {
			throw new NotFoundException("This resource has no trash");
		}
	};

	class CrudController implements CrudControllerInstance<S> {
		constructor(readonly service: S) {}

		// The `:id` param: already parsed when a pipe was chosen up front,
		// otherwise parsed by the service from its primary key column.
		async id(raw: unknown): Promise<any> {
			return idPipe ? raw : this.service.parseId(raw);
		}

		list(query: Record<string, unknown>) {
			const q = this.service.parseQuery(query, queryOptions);
			return q.isCursor
				? this.service.findByCursor(q.filters, q.pagination, q.options)
				: this.service.findAll(q.filters, q.pagination, q.options);
		}

		trash(query: Record<string, unknown>) {
			softDeleteOn(this.service);
			const q = this.service.parseQuery(query, {
				...queryOptions,
				allowTrash: false,
			});
			const opts = { ...q.options, onlyDeleted: true };
			return q.isCursor
				? this.service.findByCursor(q.filters, q.pagination, opts)
				: this.service.findAll(q.filters, q.pagination, opts);
		}

		bulkCreate(body: unknown[], query: Record<string, unknown>) {
			if (!Array.isArray(body)) {
				throw new BadRequestException("The body must be an array");
			}
			return this.service.massCreate(body, readOptions(this.service, query));
		}

		async bulkUpdate(
			body: { ids?: unknown; data?: unknown },
			query: Record<string, unknown>,
		) {
			if (!body?.data || typeof body.data !== "object") {
				throw new BadRequestException("data must be an object");
			}
			return this.service.massUpdate(
				await idsOf(this.service, body),
				body.data,
				readOptions(this.service, query),
			);
		}

		async bulkDelete(body: IdsBody) {
			const ids = await idsOf(this.service, body);
			return options.deleteMode === "soft"
				? this.service.massSoftDelete(ids)
				: this.service.massDelete(ids);
		}

		async bulkRestore(body: IdsBody, query: Record<string, unknown>) {
			softDeleteOn(this.service);
			return this.service.massRestore(
				await idsOf(this.service, body),
				readOptions(this.service, query),
			);
		}

		async get(rawId: unknown, query: Record<string, unknown>) {
			const id = await this.id(rawId);
			const row = await this.service.find(id, readOptions(this.service, query));
			if (!row) {
				throw new EntityNotFoundException(
					(this.service as any).getEntityName(),
					id,
				);
			}
			return row;
		}

		create(body: unknown, query: Record<string, unknown>) {
			return this.service.create(body, readOptions(this.service, query));
		}

		async update(
			rawId: unknown,
			body: unknown,
			query: Record<string, unknown>,
		) {
			return this.service.update(
				await this.id(rawId),
				body,
				readOptions(this.service, query),
			);
		}

		async delete(rawId: unknown) {
			const id = await this.id(rawId);
			return options.deleteMode === "soft"
				? this.service.softDelete(id)
				: this.service.delete(id);
		}

		async softDelete(rawId: unknown) {
			softDeleteOn(this.service);
			return this.service.softDelete(await this.id(rawId));
		}

		async restore(rawId: unknown, query: Record<string, unknown>) {
			softDeleteOn(this.service);
			return this.service.restore(
				await this.id(rawId),
				readOptions(this.service, query),
			);
		}
	}

	// Constructor injection without emitDecoratorMetadata: name the service.
	Inject(service)(CrudController, undefined as unknown as string, 0);
	Reflect.defineMetadata("design:paramtypes", [service], CrudController);

	const proto = CrudController.prototype as unknown as Record<string, any>;
	const idParam = () => (idPipe ? Param("id", idPipe) : Param("id"));
	const openapi =
		options.openapi === true ? service : (options.openapi ?? undefined);

	// Express matches routes in the order they are registered, and Nest
	// registers them in prototype order, so the static paths (/trash, /bulk)
	// are declared above /:id.
	const routes: Array<{
		name: CrudRouteName;
		http: MethodDecorator;
		params: ParameterDecorator[];
		types: unknown[];
		extra?: MethodDecorator[];
	}> = [
		{
			name: "list",
			http: Get(),
			params: [Query()],
			types: [Object],
			extra: openapi ? [ApiCrudList(openapi)] : [],
		},
		{
			name: "trash",
			http: Get("trash"),
			params: [Query()],
			types: [Object],
			extra: openapi ? [ApiCrudList(openapi, { trash: true })] : [],
		},
		{
			name: "bulkCreate",
			http: Post("bulk"),
			params: [
				options.dto?.create
					? Body(
							new ParseArrayPipe({
								...options.validation,
								items: options.dto.create,
							}),
						)
					: Body(),
				Query(),
			],
			types: [Array, Object],
		},
		{
			name: "bulkUpdate",
			http: Patch("bulk"),
			params: [
				options.dto?.update
					? Body(new BulkUpdateBodyPipe(options.dto.update, options.validation))
					: Body(),
				Query(),
			],
			types: [Object, Object],
			extra: [HttpCode(200)],
		},
		{
			name: "bulkDelete",
			http: Post("bulk-delete"),
			params: [Body()],
			types: [Object],
			extra: [HttpCode(200)],
		},
		{
			name: "bulkRestore",
			http: Post("bulk-restore"),
			params: [Body(), Query()],
			types: [Object, Object],
			extra: [HttpCode(200)],
		},
		{
			name: "get",
			http: Get(":id"),
			params: [idParam(), Query()],
			types: [Object, Object],
		},
		{
			name: "create",
			http: Post(),
			params: [Body(), Query()],
			types: [options.dto?.create ?? Object, Object],
		},
		{
			name: "update",
			http: Patch(":id"),
			params: [idParam(), Body(), Query()],
			types: [Object, options.dto?.update ?? Object, Object],
		},
		{
			name: "delete",
			http: Delete(":id"),
			params: [idParam()],
			types: [Object],
		},
		{
			name: "softDelete",
			http: Post(":id/soft-delete"),
			params: [idParam()],
			types: [Object],
			extra: [HttpCode(200)],
		},
		{
			name: "restore",
			http: Post(":id/restore"),
			params: [idParam(), Query()],
			types: [Object, Object],
			extra: [HttpCode(200)],
		},
	];

	// Rebuild the prototype in route order, so the registration order above
	// holds whatever order the class body declared them in.
	const handlers = new Map(
		routes.map((route) => [route.name, proto[route.name]]),
	);
	for (const route of routes) delete proto[route.name];
	for (const route of routes) {
		const settings = routeOptions(route.name);
		if (!settings) continue;
		Object.defineProperty(proto, route.name, {
			value: handlers.get(route.name),
			writable: true,
			configurable: true,
			enumerable: false,
		});
		let descriptor = Object.getOwnPropertyDescriptor(proto, route.name)!;
		route.params.forEach((decorate, index) => {
			decorate(proto, route.name, index);
		});
		Reflect.defineMetadata("design:paramtypes", route.types, proto, route.name);
		// Applied the way TypeScript applies stacked decorators: last first, each
		// one seeing the descriptor the previous returned. A decorator that wraps
		// the handler then really wraps it, and the route decorators, applied
		// last, tag the final function.
		const decorators = [
			route.http,
			...(route.extra ?? []),
			...(settings.decorators ?? []),
			...(options.decorators ?? []),
		];
		// Reversed, so the shared decorators still run before the per-route ones
		// (guard order) and the route's own HTTP decorator runs last.
		for (const decorate of decorators.reverse()) {
			descriptor =
				(decorate(proto, route.name, descriptor) as
					| PropertyDescriptor
					| undefined) ?? descriptor;
		}
		Object.defineProperty(proto, route.name, descriptor);
	}

	for (const decorate of options.classDecorators ?? []) {
		decorate(CrudController);
	}
	if (options.path !== undefined) Controller(options.path)(CrudController);
	return CrudController;
}
