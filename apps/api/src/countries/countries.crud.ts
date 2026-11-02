import type { CrudFeatureConfig } from "nestjs-drizzle-crud";
import { cities, countryTags, regions, states, tags } from "../db/schema";

// The countries config, shared by forFeature (countries.module.ts) and the
// OpenAPI docs of GET /countries (countries.controller.ts).
export const countriesCrud = {
	primaryKey: "id",
	primaryKeyType: "serial",
	relations: {
		// belongs-to: countries.region_id -> regions.id
		region: { table: regions, localKey: "region_id" },
		// has-many: states.country_id -> countries.id, alphabetical,
		// with its own has-many so `states.cities` can be eager-loaded
		states: {
			table: states,
			type: "hasMany",
			foreignKey: "country_id",
			orderBy: [{ column: "name", order: "asc" }],
			relations: {
				cities: {
					table: cities,
					type: "hasMany",
					foreignKey: "state_id",
					orderBy: [{ column: "name", order: "asc" }],
				},
			},
		},
		// many-to-many: countries <-> tags through country_tags
		tags: {
			table: tags,
			type: "manyToMany",
			through: countryTags,
			throughLocalKey: "country_id",
			throughForeignKey: "tag_id",
			orderBy: [{ column: "name", order: "asc" }],
		},
	},
	defaultSort: [{ column: "name", order: "asc" }],
	// What a client may touch through the query string. Anything
	// else is a 400. updated_at is left out of selectableColumns on
	// purpose, to show a column a client cannot ask for.
	filterableColumns: [
		"id",
		"name",
		"code",
		"region_id",
		"region.name",
		"region.code",
		"states.name",
		"tags.name",
	],
	sortableColumns: ["name", "code", "region.name"],
	selectableColumns: [
		"id",
		"name",
		"code",
		"region_id",
		"created_at",
		"region.name",
		"region.code",
		"states.name",
		"states.code",
		"states.cities.name",
		"tags.name",
	],
	searchableColumns: ["name", "code"],
	loadableRelations: ["region", "states.cities", "tags"],
	writableColumns: ["name", "code", "region_id"],
} satisfies CrudFeatureConfig;
