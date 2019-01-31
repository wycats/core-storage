import { Option, Dict, dict, entries } from "ts-std";
import {
  Tag,
  DirtyableTag,
  TagWrapper,
  UpdatableDirtyableTag,
  consume,
  compute,
  VersionedPathReference
} from "@glimmer/reference";
import * as uuid from "uuid/v4";
import {
  DatabaseSchema,
  KeyType,
  EntityName,
  EntityReference,
  EntityId,
  Properties,
  Derived,
  SchemaForEntityName,
  QueriesFor,
  QueryArgs,
  QueryReturn,
  DerivedReturn,
  PropertiesFor
} from "./schema";
import { TypeIndexRecord } from "./type-index";

export interface Registration<
  S extends DatabaseSchema,
  K extends EntityName<S>
> {
  key: KeyType;
  derived?: {
    [key: string]: (
      data: Properties<S, K>,
      database: DatabaseImpl<S>
    ) => unknown;
  };
}

class ReadonlyPrivateMap {
  private map = new WeakMap();

  constructor(private desc: string, private type: string) {}

  init<S extends DatabaseSchema>(key: DatabaseImpl<S>, value: Index<S>): void {
    if (this.map.has(key)) {
      throw new Error("Can only initialize private state once");
    }

    this.map.set(key, value);
  }

  get<S extends DatabaseSchema>(key: DatabaseImpl<S>): Index<S> {
    if (!this.map.has(key)) {
      throw new Error(`#${this.desc} is only available on ${this.type}`);
    }

    return this.map.get(key);
  }
}

const INDEX = new ReadonlyPrivateMap("index", "Store");

type QueryTags<S extends DatabaseSchema> = {
  [P in keyof QueriesFor<S>]?: TagWrapper<UpdatableDirtyableTag>
};

export function newId<S extends DatabaseSchema, K extends EntityName<S>>(
  type: K,
  registration: Registration<S, K>
): EntityId<S, K> {
  switch (registration.key) {
    case KeyType.Singleton:
      return { keyType: KeyType.Singleton, value: type } as EntityId<S, K>;

    case KeyType.UUID:
      return { keyType: KeyType.UUID, value: uuid.default() };

    default:
      throw new Error(
        `Unimplemented keyFor for ${
          registration.key
        } key type (${JSON.stringify(registration)})`
      );
  }
}

export function idFor<S extends DatabaseSchema, K extends EntityName<S>>(
  registration: Registration<S, K>,
  key: string
): EntityId<S, K> {
  switch (registration.key) {
    case KeyType.Singleton:
      return { keyType: KeyType.Singleton, value: key } as EntityId<S, K>;

    case KeyType.UUID:
      return { keyType: KeyType.UUID, value: key };

    default:
      throw new Error(
        `Unimplemented keyFor for ${
          registration.key
        } key type (${JSON.stringify(registration)})`
      );
  }
}

export class TypeIndexImpl<S extends DatabaseSchema, K extends EntityName<S>> {
  readonly record: TypeIndexRecord<S, K> = new TypeIndexRecord();

  constructor(readonly type: K, readonly registration: Registration<S, K>) {}

  get allTag(): TagWrapper<DirtyableTag> {
    return this.record.allTag;
  }

  insert(key: EntityReference<K>, data: Properties<S, K>): void {
    this.record.insert(key, data);
  }

  delete(key: EntityReference<K>): void {
    let { entities } = this.record;
    let id = key.id.value;

    entities[id]!.dirtyAll();
    delete entities[id];

    this.record.allTag.inner.dirty();
  }

  patch(key: EntityReference<K>, updates: Partial<Properties<S, K>>): void {
    this.record.patchProperties(key.id.value, updates);
  }

  all(): Array<EntityReference<K>> {
    let out: Array<EntityReference<K>> = [];

    this.record.eachEntity((_item, key) => {
      out.push({ type: this.type, id: idFor(this.registration, key) });
    });

    consume(this.record.allTag);

    return out;
  }

  get(key: EntityReference<K>): Option<Properties<SchemaForEntityName<K>, K>> {
    let id = key.id.value;

    let properties = this.record.getProperties(key.id.value);

    if (properties === undefined) {
      return null;
    } else {
      this.consume(id);
      return properties;
    }
  }

  private consume(id: string, key?: keyof PropertiesFor<K>): void {
    if (id in this.record.entities) {
      this.record.entities[id]!.consume();
    }

    if (!key) return;

    if (id in this.record.entities) {
      let entity = this.record.entities[id]!;

      entity.consumeProperty(key);
    }
  }

  entityTag(id: EntityReference<K>): Tag {
    let tags = this.record.entities[id.id.value]!;

    return tags.entity();
  }

  propertyTag(
    id: EntityReference<K>,
    key: keyof Properties<SchemaForEntityName<K>, K>
  ): Tag {
    let tags = this.record.entities[id.id.value]!;

    return tags.getPropertyTag(key);
  }

  derivedTag<
    K extends EntityName<DatabaseSchema>,
    P extends keyof Derived<SchemaForEntityName<K>, K>
  >(id: EntityReference<K>, key: P): TagWrapper<UpdatableDirtyableTag> {
    let tags = this.record.entities[id.id.value]!;

    return tags.getDerivedTag(key);
  }
}

class Index<S extends DatabaseSchema> {
  readonly registrations: { [K in EntityName<S>]?: Registration<S, K> } = {};
  readonly queryTags: Dict<QueryTags<S>> = {};
  readonly indexByType: { [K in EntityName<S>]?: TypeIndexImpl<S, K> } = {};

  constructor(readonly queries?: QueryRegistrations<S>) {}

  register<K extends EntityName<S>>(
    type: K,
    registration: Registration<S, K>
  ): void {
    this.registrations[type] = registration;
  }

  idFor<K extends EntityName<S>>(
    type: K,
    _entity: Properties<S, K>
  ): EntityId<S, K> {
    let registration = this.registrations[type];

    if (registration === undefined) {
      throw new Error(`Unexpected entity type ${type}`);
    } else {
      switch (registration.key) {
        case KeyType.Singleton:
          return { keyType: KeyType.Singleton, value: type } as EntityId<S, K>;

        case KeyType.UUID:
          return { keyType: KeyType.UUID, value: uuid.default() };

        default:
          throw new Error(
            `Unimplemented keyFor for ${
              registration.key
            } key type (${JSON.stringify(registration)})`
          );
      }
    }
  }

  keyType<K extends EntityName<S>>(type: K): EntityId<S, K>["keyType"] {
    let registration = this.registrations[type];

    if (registration === undefined) {
      throw new Error(`Unexpected entity type ${type}`);
    } else {
      return registration.key;
    }
  }

  insert<K extends EntityName<S>>(
    key: EntityReference<K>,
    data: Properties<S, K>
  ): void {
    let index = this.indexFor(key.type);
    index.insert(key, data);
  }

  private indexFor<K extends EntityName<S>>(type: K): TypeIndexImpl<S, K> {
    let index = this.indexByType[type];

    if (!index) {
      index = new TypeIndexImpl<S, K>(type, this.registrations[type]!);
      this.indexByType[type] = index;
    }

    return index!;
  }

  patch<K extends EntityName<S>>(
    key: EntityReference<K>,
    updates: Partial<Properties<S, K>>
  ): void {
    let index = this.indexByType[key.type];

    if (!index) {
      throw new Error(
        `Unexpected patch of un-inserted ${key.type} id=${
          key.id.value
        } (no entities of that type found)`
      );
    }

    index.patch(key, updates);
  }

  delete<K extends EntityName<S>>(key: EntityReference<K>): void {
    let index = this.indexByType[key.type];

    if (!index) {
      throw new Error(
        `unexpected delete of non-existent entity type ${key.type}`
      );
    }

    index.delete(key);
  }

  all<K extends EntityName<S>>(type: K): Array<EntityReference<K>> {
    let index = this.indexFor(type);

    return index.all();
  }

  allTag<K extends EntityName<S>>(type: K): Tag {
    let index = this.indexFor(type);

    return index.allTag;
  }

  get<K extends EntityName<S>>(
    key: EntityReference<K>
  ): Option<Properties<S, K>> {
    let index = this.indexByType[key.type];

    if (!index) {
      throw new Error(`unexpected get of non-existent entity type ${key.type}`);
    }

    return index.get(key);
  }

  entityTag<K extends EntityName<S>>(id: EntityReference<K>): Tag {
    let index = this.indexByType[id.type];

    if (!index) {
      throw new Error(
        `unexpected entityTag of non-existent entity type ${id.type}`
      );
    }

    return index.entityTag(id);
  }

  propertyTag<K extends EntityName<S>, P extends keyof Properties<S, K>>(
    id: EntityReference<K>,
    key: P
  ): Tag {
    let index = this.indexByType[id.type];

    if (!index) {
      throw new Error(
        `unexpected propertyTag of non-existent entity type ${id.type}`
      );
    }

    return index.propertyTag(id, key);
  }

  derivedTag<K extends EntityName<S>, P extends keyof Derived<S, K>>(
    id: EntityReference<K>,
    key: P
  ): TagWrapper<UpdatableDirtyableTag> {
    let index = this.indexByType[id.type];

    if (!index) {
      throw new Error(
        `unexpected derivedTag of non-existent entity type ${id.type}`
      );
    }

    return index.derivedTag(id, key);
  }

  derived<K extends EntityName<S>, D extends keyof Derived<S, K>>(
    id: EntityReference<K>,
    name: D
  ): DerivedFunction<S, K, D> {
    let registration = this.registrations[id.type];

    if (registration === undefined) {
      throw new Error(`Unexpected entity type ${id.type}`);
    } else {
      return registration.derived![name as string] as DerivedFunction<S, K, D>;
    }
  }

  query<K extends keyof S["queries"]>(name: K): QueryRegistrations<S>[K] {
    let queries = this.queries;

    if (queries === undefined) {
      throw new Error(`Unexpected query ${name} (no queries registered)`);
    } else {
      return queries[name] as QueryRegistrations<S>[K];
    }
  }
}

export interface Database<S extends DatabaseSchema> {
  all<K extends EntityName<S>>(kind: K): Array<EntityReference<K>>;

  insert<K extends keyof S["entities"] & EntityName<S>>(
    qualifiedId: EntityReference<K>,
    entity: Properties<S, K>
  ): EntityReference<K>;
  insert<K extends EntityName<S>>(
    type: K,
    entity: Properties<S, K>
  ): EntityReference<K>;

  delete<K extends EntityName<S>>(qualifiedId: EntityReference<K>): void;

  patch<K extends EntityName<S>>(
    qualifiedId: EntityReference<K>,
    entity: Partial<Properties<S, K>>
  ): void;

  checkout<K extends EntityName<S>>(
    qualifiedId: EntityReference<K>
  ): Properties<S, K>;

  query<K extends EntityName<S>, D extends keyof Derived<S, K>>(
    id: EntityReference<K>,
    name: D
  ): VersionedPathReference<DerivedReturn<K, D>>;

  dbQuery<N extends keyof QueriesFor<S>>(
    name: N,
    ...args: QueryArgs<S, N>
  ): VersionedPathReference<QueryReturn<S, N>>;

  entityTag(id: EntityReference<EntityName<S>>): Tag;

  propertyTag<K extends EntityName<S>, P extends keyof Properties<S, K>>(
    id: EntityReference<K>,
    key: P
  ): Tag;

  derivedTag<K extends EntityName<S>, P extends keyof Derived<S, K>>(
    id: EntityReference<K>,
    key: P
  ): Tag;

  allTag<K extends EntityName<S>>(type: K): Tag;
}

export class DatabaseImpl<S extends DatabaseSchema> implements Database<S> {
  constructor(queries?: QueryRegistrations<S>) {
    INDEX.init(this, new Index(queries));
  }

  register<K extends EntityName<S>>(
    kind: K,
    registration: Registration<S, K>
  ): void {
    INDEX.get(this).register(kind, registration);
  }

  all<K extends EntityName<S>>(kind: K): Array<EntityReference<K>> {
    return INDEX.get(this).all(kind);
  }

  insert<K extends keyof S["entities"] & EntityName<S>>(
    qualifiedId: EntityReference<K>,
    entity: Properties<S, K>
  ): EntityReference<K>;
  insert<K extends EntityName<S>>(
    type: K,
    entity: Properties<S, K>
  ): EntityReference<K>;
  insert<K extends EntityName<S>>(
    refOrType: K | EntityReference<K>,
    entity: Properties<S, K>
  ): EntityReference<K> {
    let index = INDEX.get(this);

    let ref: EntityReference<K>;

    if (refOrType && typeof refOrType === "object") {
      ref = refOrType;
    } else {
      let id = index.idFor(refOrType, entity);
      ref = { type: refOrType, id };
    }

    index.insert(ref, entity);

    return ref;
  }

  delete<K extends EntityName<S>>(qualifiedId: EntityReference<K>): void {
    INDEX.get(this).delete(qualifiedId);
  }

  patch<K extends EntityName<S>>(
    qualifiedId: EntityReference<K>,
    entity: Partial<Properties<S, K>>
  ): void {
    INDEX.get(this).patch(qualifiedId, entity);
  }

  checkout<K extends EntityName<S>>(
    qualifiedId: EntityReference<K>
  ): Properties<S, K> {
    let data = INDEX.get(this).get(qualifiedId);

    if (data === null) {
      throw new Error(
        `Unexpected missing data for ${qualifiedId.type} id=${
          qualifiedId.id.value
        }`
      );
    } else {
      return data;
    }
  }

  query<K extends EntityName<S>, D extends keyof Derived<S, K>>(
    id: EntityReference<K>,
    name: D
  ): VersionedPathReference<DerivedReturn<K, D>> {
    let index = INDEX.get(this);
    let derived: (
      data: Properties<SchemaForEntityName<K>, K>,
      database: DatabaseImpl<S>
    ) => DerivedReturn<K, D> = index.derived(id, name);

    return compute(() => derived(this.checkout(id), this as DatabaseImpl<S>));
  }

  dbQuery<N extends keyof QueriesFor<S>>(
    name: N,
    ...args: QueryArgs<S, N>
  ): VersionedPathReference<QueryReturn<S, N>> {
    let index = INDEX.get(this);

    let query = index.query(name);

    return compute(() => query(this, ...args));
  }

  entityTag(id: EntityReference<EntityName<S>>): Tag {
    return INDEX.get(this).entityTag(id);
  }

  propertyTag<K extends EntityName<S>, P extends keyof Properties<S, K>>(
    id: EntityReference<K>,
    key: P
  ): Tag {
    return INDEX.get(this).propertyTag(id, key);
  }

  derivedTag<K extends EntityName<S>, P extends keyof Derived<S, K>>(
    id: EntityReference<K>,
    key: P
  ): Tag {
    return INDEX.get(this).derivedTag(id, key);
  }

  allTag<K extends EntityName<S>>(type: K): Tag {
    return INDEX.get(this).allTag(type);
  }

  revision<K extends EntityName<S>>(id: EntityReference<K>): number {
    return INDEX.get(this)
      .entityTag(id)
      .value();
  }

  validate<K extends EntityName<S>>(
    id: EntityReference<K>,
    snapshot: number
  ): boolean {
    return INDEX.get(this)
      .entityTag(id)
      .validate(snapshot);
  }
}

export type MapObject<I extends object, O> = { [P in keyof I]: O };

export function mapObject<D extends object, O>(
  input: D,
  callback: <K extends keyof D>(input: D[K]) => O
): MapObject<D, O> {
  let out = dict();

  for (let [key, value] of entries(input)) {
    out[key] = callback(value!);
  }

  return out as MapObject<D, O>;
}

export type DerivedArgs<K extends EntityName<DatabaseSchema>> = [
  Properties<SchemaForEntityName<K>, K>,
  DatabaseImpl<SchemaForEntityName<K>>
];

export type DerivedFunction<
  S extends DatabaseSchema,
  K extends EntityName<S>,
  D extends keyof Derived<S, K>
> = (data: Properties<S, K>, database: DatabaseImpl<S>) => DerivedReturn<K, D>;

export type QueryRegistrations<S extends DatabaseSchema> = {
  [K in keyof S["queries"]]: (
    database: DatabaseImpl<S>,
    ...args: QueryArgs<S, K>
  ) => QueryReturn<S, K>
};
