import {
	integer,
	pgTable,
	serial,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

// Mirrors the existing Neon tables: regions -> countries -> states -> cities
// (belongs-to chain), plus a uuid-keyed tags table. Column keys match the DB
// column names because the CRUD config references them by string.

const timestamps = {
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
};

export const regions = pgTable("regions", {
	id: serial("id").primaryKey(),
	name: varchar("name").notNull(),
	code: varchar("code").notNull(),
	...timestamps,
});

export const countries = pgTable("countries", {
	id: serial("id").primaryKey(),
	name: varchar("name").notNull(),
	code: varchar("code").notNull(),
	region_id: integer("region_id"),
	...timestamps,
});

export const states = pgTable("states", {
	id: serial("id").primaryKey(),
	name: varchar("name").notNull(),
	code: varchar("code").notNull(),
	country_id: integer("country_id"),
	...timestamps,
});

export const cities = pgTable("cities", {
	id: serial("id").primaryKey(),
	name: varchar("name").notNull(),
	state_id: integer("state_id"),
	...timestamps,
});

export const tags = pgTable("tags", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: varchar("name").notNull(),
	...timestamps,
});

// Join table for the countries <-> tags many-to-many relation.
export const countryTags = pgTable("country_tags", {
	country_id: integer("country_id").notNull(),
	tag_id: uuid("tag_id").notNull(),
});
