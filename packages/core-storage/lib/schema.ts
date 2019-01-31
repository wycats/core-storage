export interface DatabaseSchema {
  entities: {
    [table: string]: Entity;
  };

  queries: Queries;
}

export type Queries = {
  [name: string]: Query;
};

export type Query = (...args: any[]) => any;

export interface Entity {
  id: Id;
  properties: object;
  derived?: object;
  queries?: object;
}

export type DatabaseEntities<S extends DatabaseSchema> = S["entities"];

// A union of all possible table names for a schema
export type EntityName<S extends DatabaseSchema> = keyof S["entities"] & string;

export type SchemaForEntityName<
  S extends EntityName<DatabaseSchema>
> = S extends EntityName<infer S> ? S : never;

export type EntityId<
  S extends DatabaseSchema,
  K extends EntityName<S>
> = DatabaseEntityFor<S, K>["id"];

// The properties interface for an entity name
export type Properties<
  S extends DatabaseSchema,
  K extends EntityName<S>
> = DatabaseEntityFor<S, K>["properties"];

export type PropertiesFor<K extends EntityName<DatabaseSchema>> = Properties<
  SchemaForEntityName<K>,
  K
>;

// The list of entity names in the DatabaseSchema
export type DatabaseEntityNames<
  S extends DatabaseSchema
> = keyof DatabaseEntities<S>;

// The Entity for a particular entity name
export type DatabaseEntityFor<
  S extends DatabaseSchema,
  K extends DatabaseEntityNames<S>
> = S["entities"][K];

// An `Id`, which serves as the database index for an entity.
export type Id<I extends string = string> =
  | { keyType: KeyType.Singleton; value: I }
  | { keyType: KeyType.UUID; value: I };

// An `EntityReference` pairs an entity's dataase table name with its ID
export interface EntityReference<K extends EntityName<DatabaseSchema>> {
  type: K;
  id: EntityId<SchemaForEntityName<K>, K>;
}

export const enum KeyType {
  Singleton = "Singleton",
  UUID = "UUID"
}

export type Derived<
  S extends DatabaseSchema,
  K extends EntityName<DatabaseSchema>
> = DatabaseEntityFor<S, K>["derived"];

export type DerivedReturn<
  K extends EntityName<DatabaseSchema>,
  D extends keyof DatabaseEntityFor<SchemaForEntityName<K>, K>["derived"]
> = DatabaseEntityFor<SchemaForEntityName<K>, K>[D] extends (
  data: Properties<SchemaForEntityName<K>, K>
) => infer R
  ? R
  : never;

export type QueriesFor<S extends DatabaseSchema> = S["queries"];

export type QueryArgs<
  S extends DatabaseSchema,
  N extends keyof S["queries"]
> = S["queries"][N] extends (...args: infer A) => any ? A : never;

export type QueryReturn<
  S extends DatabaseSchema,
  N extends keyof S["queries"]
> = S["queries"][N] extends (...args: any[]) => infer R ? R : never;
