import type { SortInput } from "./query.interface";

export interface PaginationOptions {
	page?: number;
	limit?: number;
	// One column, or a list: ["region.name", "-name"] or [{ column, order }].
	sortBy?: SortInput;
	sortOrder?: "asc" | "desc";
}

export interface BulkOperationResult<T> {
	success: boolean;
	data?: T[];
	errors?: Array<{ id?: any; index?: number; error: Error }>;
}

export interface OperationOptions {
	transaction?: any;
	relations?: string[];
	select?: string[];
	search?: {
		term: string;
		columns: string[];
		mode?: "ilike" | "fullText";
	};
	hooks?: {
		skipBefore?: boolean;
		skipAfter?: boolean;
	};
}

export interface ICrudService<T, CreateDto, UpdateDto, FilterDto = any> {
	// Single Operations
	find(id: any, options?: OperationOptions): Promise<T | null>;
	findOne(where: Partial<T>, options?: OperationOptions): Promise<T | null>;
	findAll(
		filters?: FilterDto,
		pagination?: PaginationOptions,
		options?: OperationOptions,
	): Promise<{ data: T[]; total: number; page: number; limit: number }>;

	create(data: CreateDto, options?: OperationOptions): Promise<T>;
	update(id: any, data: UpdateDto, options?: OperationOptions): Promise<T>;

	softDelete(id: any, options?: OperationOptions): Promise<boolean>;
	restore(id: any, options?: OperationOptions): Promise<T>;
	delete(id: any, options?: OperationOptions): Promise<boolean>;

	// Bulk Operations
	massCreate(data: CreateDto[], options?: OperationOptions): Promise<T[]>;
	massUpdate(
		ids: any[],
		data: UpdateDto,
		options?: OperationOptions,
	): Promise<T[]>;
	massSoftDelete(ids: any[], options?: OperationOptions): Promise<boolean>;
	massRestore(ids: any[], options?: OperationOptions): Promise<T[]>;
	massDelete(ids: any[], options?: OperationOptions): Promise<boolean>;

	// Utility Methods
	exists(id: any, options?: OperationOptions): Promise<boolean>;
	count(filters?: FilterDto, options?: OperationOptions): Promise<number>;
}
