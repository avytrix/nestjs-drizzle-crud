// The config keys that hold an object of settings. An override names only the
// settings it changes, so these merge one level deep instead of replacing the
// whole object: `pagination: { defaultLimit: 5 }` keeps the default maxLimit.
const NESTED_KEYS = ["softDelete", "timestamps", "pagination", "sql"] as const;

export function isPlainObject(value: unknown): value is Record<string, any> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		!(value instanceof Date)
	);
}

// Layer `override` over `base`. A nested key merges when both sides are
// objects; any other value, including an explicit `undefined` (timestamps off),
// replaces the base value as before.
export function mergeCrudConfig<C extends Record<string, any>>(
	base: C,
	override: Record<string, any> | undefined,
): C {
	const out: Record<string, any> = { ...base, ...(override ?? {}) };
	for (const key of NESTED_KEYS) {
		const a = base?.[key];
		const b = override?.[key];
		if (isPlainObject(a) && isPlainObject(b)) out[key] = { ...a, ...b };
	}
	return out as C;
}
