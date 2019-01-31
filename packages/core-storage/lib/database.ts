import { Option, Dict, dict, entries, keys } from "ts-std";
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

interface Registration<S extends DatabaseSchema, K extends EntityName<S>> {
  key: KeyType;
  derived?: {
    [key: string]: (data: Properties<S, K>, database: Database<S>) => unknown;
  };
}

class ReadonlyPrivateMap {
  private map = new WeakMap();

  constructor(private desc: string, private type: string) {}

  init<S extends DatabaseSchema>(key: Database<S>, value: Index<S>): void {
    if (this.map.has(key)) {
      throw new Error("Can only initialize private state once");
    }

    this.map.set(key, value);
  }

  get<S extends DatabaseSchema>(key: Database<S>): Index<S> {
    if (!this.map.has(key)) {
      throw new Error(`#${this.desc} is only available on ${this.type}`);
    }

    return this.map.get(key);
  }
}

const INDEX = new ReadonlyPrivateMap("index", "Store");

type DerivedTags<K extends EntityName<DatabaseSchema>> = {
  [P in keyof Derived<SchemaForEntityName<K>, K>]?: TagWrapper<
    UpdatableDirtyableTag
  >
};

type QueryTags<S extends DatabaseSchema> = {
  [P in keyof QueriesFor<S>]?: TagWrapper<UpdatableDirtyableTag>
};

class EntityTags<S extends DatabaseSchema, K extends EntityName<S>> {
  private propertyTags: Map<
    keyof Properties<S, K>,
    TagWrapper<DirtyableTag>
  > = new Map();

  private entityTag = DirtyableTag.create();

  constructor(properties: Properties<S, K>) {
    let { propertyTags: map } = this;

    keys(properties).forEach(key => {
      map.set(key, DirtyableTag.create());
    });
  }

  consume(): void {
    consume(this.entityTag);
  }

  consumeProperty(key: keyof Properties<S, K>): void {
    consume(this.propertyTags.get(key)!);
  }

  has(key: keyof Properties<S, K>): boolean {
    return this.propertyTags.has(key);
  }

  get(key: keyof Properties<S, K>): TagWrapper<DirtyableTag> {
    return this.propertyTags.get(key)!;
  }

  entity(): TagWrapper<DirtyableTag> {
    return this.entityTag;
  }

  dirty(): void {
    for (let value of this.propertyTags.values()) {
      value.inner.dirty();
    }

    this.entityTag.inner.dirty();
  }
}

class TypeIndex<S extends DatabaseSchema, K extends EntityName<S>> {
  readonly properties: Dict<PropertiesFor<K>> = {};
  readonly entityTags: Dict<EntityTags<S, K>> = {};
  // readonly entityTags: Dict<TagWrapper<DirtyableTag>> = {};
  readonly derivedTags: Dict<DerivedTags<K>> = {};
  readonly allTag: TagWrapper<DirtyableTag> = DirtyableTag.create();

  constructor(readonly type: K, readonly registration: Registration<S, K>) {}

  newId(): EntityId<S, K> {
    let registration = this.registration;

    switch (registration.key) {
      case KeyType.Singleton:
        return { keyType: KeyType.Singleton, value: this.type } as EntityId<
          S,
          K
        >;

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

  idFor(key: string): EntityId<S, K> {
    let { registration } = this;

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

  insert(key: EntityReference<K>, data: Properties<S, K>): void {
    let { properties, entityTags } = this;

    properties[key.id.value] = data;
    entityTags[key.id.value] = new EntityTags(data);

    this.allTag.inner.dirty();
  }

  delete(key: EntityReference<K>): void {
    let { properties, entityTags } = this;
    let id = key.id.value;

    delete properties[id];
    entityTags[id]!.dirty();
    delete entityTags[id];

    this.allTag.inner.dirty();
  }

  patch(key: EntityReference<K>, updates: Partial<Properties<S, K>>): void {
    let { properties } = this;

    let existing = properties[key.id.value];
    let updated = { ...existing, ...updates };

    properties[key.id.value] = updated;

    let tags = this.entityTags[key.id.value]!;

    for (let key of keys(updates)) {
      if (!tags.has(key)) {
        throw new Error(
          `Unexpected property '${key}' passed to patch that wasn't present in insert`
        );
      }

      tags.get(key).inner.dirty();
    }

    let entity = this.entityTags[key.id.value]!;

    entity.dirty();
    this.allTag.inner.dirty();
  }

  all(): Array<EntityReference<K>> {
    let out: Array<EntityReference<K>> = [];

    Object.keys(this.properties).forEach(key => {
      out.push({ type: this.type, id: this.idFor(key) });
    });

    consume(this.allTag);

    return out;
  }

  get(id: string): Option<Properties<SchemaForEntityName<K>, K>> {
    let { properties } = this;

    if (properties[id] === undefined) {
      return null;
    } else {
      this.consume(id);
      return properties[id]!;
    }
  }

  private consume(id: string, key?: keyof PropertiesFor<K>): void {
    if (id in this.entityTags) {
      this.entityTags[id]!.consume();
    }

    if (!key) return;

    if (id in this.entityTags) {
      let tags = this.entityTags[id]!;

      if (tags.has(key)) {
        tags.consumeProperty(key);
      }
    }
  }

  entityTag(id: EntityReference<K>): Tag {
    let tags = this.entityTags[id.id.value]!;

    return tags.entity();
  }

  propertyTag(
    id: EntityReference<K>,
    key: keyof Properties<SchemaForEntityName<K>, K>
  ): Tag {
    let tags = this.entityTags[id.id.value]!;

    return tags.get(key);
  }

  derivedTag<
    K extends EntityName<DatabaseSchema>,
    P extends keyof Derived<SchemaForEntityName<K>, K>
  >(id: EntityReference<K>, key: P): TagWrapper<UpdatableDirtyableTag> {
    let tags = this.derivedTags[id.id.value]!;

    if (!tags) {
      tags = {};
    }

    let tag: TagWrapper<UpdatableDirtyableTag> | undefined = tags[key];

    if (!tag) {
      tag = tags[key] = UpdatableDirtyableTag.create();
    }

    return tag;
  }
}

class Index<S extends DatabaseSchema> {
  readonly registrations: { [K in EntityName<S>]?: Registration<S, K> } = {};
  readonly queryTags: Dict<QueryTags<S>> = {};
  readonly indexByType: { [K in EntityName<S>]?: TypeIndex<S, K> } = {};

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

  private indexFor<K extends EntityName<S>>(type: K): TypeIndex<S, K> {
    let index = this.indexByType[type];

    if (!index) {
      index = new TypeIndex<S, K>(type, this.registrations[type]!);
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
      throw new Error(`unexpected get of non-existent entity type ${key.type}`);
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

  get<K extends EntityName<S>>(type: K, id: string): Option<Properties<S, K>> {
    let index = this.indexByType[type];

    if (!index) {
      throw new Error(`unexpected get of non-existent entity type ${type}`);
    }

    return index.get(id);
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

export class Database<S extends DatabaseSchema> {
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
    let data = INDEX.get(this).get(qualifiedId.type, qualifiedId.id.value);

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

  peek<K extends EntityName<S>>(
    qualifiedId: EntityReference<K>
  ): Option<Properties<S, K>> {
    let data = INDEX.get(this).get(qualifiedId.type, qualifiedId.id.value);

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
      database: Database<S>
    ) => DerivedReturn<K, D> = index.derived(id, name);

    return compute(() => derived(this.checkout(id), this as Database<S>));
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
  Database<SchemaForEntityName<K>>
];

export type DerivedFunction<
  S extends DatabaseSchema,
  K extends EntityName<S>,
  D extends keyof Derived<S, K>
> = (data: Properties<S, K>, database: Database<S>) => DerivedReturn<K, D>;

export type QueryRegistrations<S extends DatabaseSchema> = {
  [K in keyof S["queries"]]: (
    database: Database<S>,
    ...args: QueryArgs<S, K>
  ) => QueryReturn<S, K>
};
