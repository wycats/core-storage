import { Table, Id, Key, EntityReference } from "./table";
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

export interface ModelSchema {
  id: Id;
  properties: object;
  derived?: object;
  queries?: object;
}

export type ModelId<S, K extends keyof S> = S[K] extends ModelSchema
  ? S[K]["id"]
  : never;

export type Entities<S extends ModelSchemas> = S["entities"];

export type Entity<
  S extends ModelSchemas,
  K extends keyof Entities<S>
> = S["entities"][K];

type Properties<S extends ModelSchemas, K extends EntityName<S>> = Entity<
  S,
  K
>["properties"];

type Derived<S extends ModelSchemas, K extends EntityName<S>> = Entity<
  S,
  K
>["derived"];

export type EntityId<S extends ModelSchemas, K extends EntityName<S>> = Entity<
  S,
  K
>["id"];

export type DerivedFunctionFor<
  S extends ModelSchemas,
  K extends EntityName<S>,
  P extends keyof Derived<S, K>
> = DerivedFunction<Derived<S, K>[P], S>;

export type DerivedFunction<F, S extends ModelSchemas> = F extends (
  self: any,
  data?: infer A
) => infer R
  ? (data: A, database?: Database<S>) => R
  : never;

interface Registration<S extends ModelSchemas, K extends EntityName<S>> {
  key: Key;
  derived?: {
    [key: string]: (data: Properties<S, K>, database: Database<S>) => unknown;
  };
}

export type DatabaseQuery<S extends ModelSchemas, U> = (
  database: Database<S>
) => VersionedPathReference<U>;

export interface ModelSchemas {
  entities: {
    [key: string]: ModelSchema;
  };

  queries?: DatabaseQueries<this>;
}

export type DatabaseQueries<S extends ModelSchemas> = {
  [key: string]: DatabaseQuery<S, unknown>;
};

export type EntityName<S extends ModelSchemas> = keyof S["entities"];

class ReadonlyPrivateMap {
  private map = new WeakMap();

  constructor(private desc: string, private type: string) {}

  init<S extends ModelSchemas>(key: Database<S>, value: Index<S>): void {
    if (this.map.has(key)) {
      throw new Error("Can only initialize private state once");
    }

    this.map.set(key, value);
  }

  get<S extends ModelSchemas>(key: Database<S>): Index<S> {
    if (!this.map.has(key)) {
      throw new Error(`#${this.desc} is only available on ${this.type}`);
    }

    return this.map.get(key);
  }
}

const INDEX = new ReadonlyPrivateMap("index", "Store");

type PropertyTags<S extends ModelSchemas, K extends EntityName<S>> = {
  [P in keyof Properties<S, K>]?: TagWrapper<DirtyableTag>
};

type DerivedTags<S extends ModelSchemas, K extends EntityName<S>> = {
  [P in keyof Derived<S, K>]?: TagWrapper<UpdatableDirtyableTag>
};

class TypeIndex<S extends ModelSchemas, K extends EntityName<S>> {
  readonly properties: Dict<Properties<S, K>> = {};
  readonly propertyTags: Dict<PropertyTags<S, K>> = {};
  readonly entityTags: Dict<TagWrapper<DirtyableTag>> = {};
  readonly derivedTags: Dict<DerivedTags<S, K>> = {};

  insert(key: EntityReference<S, K>, data: Properties<S, K>): void {
    let { properties, propertyTags, entityTags } = this;

    properties[key.id.value] = data;
    propertyTags[key.id.value] = mapObject(data, () => DirtyableTag.create());
    entityTags[key.id.value] = DirtyableTag.create();
  }

  patch(key: EntityReference<S, K>, updates: Partial<Properties<S, K>>): void {
    let { properties } = this;

    let existing = properties[key.id.value];
    let updated = { ...existing, ...updates };

    properties[key.id.value] = updated;

    let tags = this.propertyTags[key.id.value]!;

    for (let key of keys(updates)) {
      if (tags[key]) tags[key]!.inner.dirty();
    }

    let entity = this.entityTags[key.id.value]!;

    entity.inner.dirty();
  }

  get(id: string): Option<Properties<S, K>> {
    let { properties } = this;

    if (properties[id] === undefined) {
      return null;
    } else {
      this.consume(id);
      return properties[id]!;
    }
  }

  private consume(id: string, key?: keyof Properties<S, K>): void {
    if (id in this.entityTags) {
      consume(this.entityTags[id]!);
    }

    if (!key) return;

    if (id in this.propertyTags) {
      let tags = this.propertyTags[id]!;

      if (key in tags) {
        consume(tags[key]!);
      }
    }
  }

  entityTag(id: EntityReference<S, K>): Tag {
    let tag = this.entityTags[id.id.value]!;

    return tag;
  }

  propertyTag(id: EntityReference<S, K>, key: keyof Properties<S, K>): Tag {
    let tags = this.propertyTags[id.id.value]!;

    if (!tags) {
      tags = {};
    }

    let tag: Tag | undefined = tags[key];

    if (!tag) {
      tag = tags[key] = DirtyableTag.create();
    }

    return tag;
  }

  derivedTag<K extends EntityName<S>, P extends keyof Derived<S, K>>(
    id: EntityReference<S, K>,
    key: P
  ): TagWrapper<UpdatableDirtyableTag> {
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

class Index<S extends ModelSchemas> {
  readonly registrations: { [K in EntityName<S>]?: Registration<S, K> } = {};
  readonly indexByType: { [K in EntityName<S>]?: TypeIndex<S, K> } = {};

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
        case Key.Singleton:
          return { keyType: Key.Singleton, value: type } as EntityId<S, K>;

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
    key: EntityReference<S, K>,
    data: Properties<S, K>
  ): void {
    let index = this.indexByType[key.type];

    if (!index) {
      index = new TypeIndex();
      this.indexByType[key.type] = index;
    }

    index.insert(key, data);
  }

  patch<K extends EntityName<S>>(
    key: EntityReference<S, K>,
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

  get<K extends EntityName<S>>(type: K, id: string): Option<Properties<S, K>> {
    let index = this.indexByType[type];

    if (!index) {
      throw new Error(`unexpected get of non-existent entity type ${type}`);
    }

    return index.get(id);
  }

  entityTag<K extends EntityName<S>>(id: EntityReference<S, K>): Tag {
    let index = this.indexByType[id.type];

    if (!index) {
      throw new Error(
        `unexpected entityTag of non-existent entity type ${id.type}`
      );
    }

    return index.entityTag(id);
  }

  propertyTag<K extends EntityName<S>, P extends keyof Properties<S, K>>(
    id: EntityReference<S, K>,
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
    id: EntityReference<S, K>,
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
    type: K,
    name: D
  ): (data: Properties<S, K>, database: Database<S>) => unknown {
    let registration = this.registrations[type];

    if (registration === undefined) {
      throw new Error(`Unexpected entity type ${type}`);
    } else {
      return registration.derived![name as string];
    }
  }
}

export class Database<S extends ModelSchemas> {
  constructor() {
    INDEX.init(this, new Index());
  }

  table(_table: Table): void {
    return null as any;
  }

  register<K extends EntityName<S>>(
    kind: K,
    registration: Registration<S, K>
  ): void {
    INDEX.get(this).register(kind, registration);
  }

  insert<K extends EntityName<S>>(
    type: K,
    entity: Properties<S, K>
  ): EntityReference<S, K> {
    let index = INDEX.get(this);
    let id = index.idFor(type, entity);
    let qualifiedId = { type, id };

    index.insert(qualifiedId, entity);

    return qualifiedId;
  }

  patch<K extends EntityName<S>>(
    qualifiedId: EntityReference<S, K>,
    entity: Partial<Properties<S, K>>
  ): void {
    INDEX.get(this).patch(qualifiedId, entity);
  }

  get<K extends EntityName<S>>(
    qualifiedId: EntityReference<S, K>
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
    qualifiedId: EntityReference<S, K>
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

  derived<K extends EntityName<S>, D extends keyof Derived<S, K>>(
    id: EntityReference<S, K>,
    name: D
  ): VersionedPathReference<Derived<S, K>[D]> {
    let index = INDEX.get(this);
    let derived = index.derived(id.type, name);

    return compute(() => derived(this.get(id), this) as Derived<S, K>[D]);
  }

  entityTag<K extends EntityName<S>>(id: EntityReference<S, K>): Tag {
    return INDEX.get(this).entityTag(id);
  }

  propertyTag<K extends EntityName<S>, P extends keyof Properties<S, K>>(
    id: EntityReference<S, K>,
    key: P
  ): Tag {
    return INDEX.get(this).propertyTag(id, key);
  }

  derivedTag<K extends EntityName<S>, P extends keyof Derived<S, K>>(
    id: EntityReference<S, K>,
    key: P
  ): Tag {
    return INDEX.get(this).derivedTag(id, key);
  }
}

export type Map<I extends object, O> = { [P in keyof I]: O };

export function mapObject<D extends object, O>(
  input: D,
  callback: <K extends keyof D>(input: D[K]) => O
): Map<D, O> {
  let out = dict();

  for (let [key, value] of entries(input)) {
    out[key] = callback(value!);
  }

  return out as Map<D, O>;
}
