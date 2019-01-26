import { Table, Id, Key, QualifiedId } from "./table";
import { Option, Dict, dict, entries, keys } from "ts-std";
import {
  Tag,
  CONSTANT_TAG,
  DirtyableTag,
  TagWrapper
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

export type ModelProperties<S extends ModelSchema> = S["properties"];

export type ModelDerived<S extends ModelSchemas, K extends keyof S> = Derived<
  S[K]
>;

export type Derived<S extends ModelSchema> = {
  [P in keyof S["derived"]]: DerivedFunction<S["derived"][P]>
};

export type DerivedFunction<F> = F extends (
  self: any,
  ...args: infer A
) => infer R
  ? (...args: A) => R
  : never;

interface Registration<S extends ModelSchema> {
  key: Key;
  derived: { [key: string]: (data: S["properties"]) => unknown };
}

export interface ModelSchemas {
  [key: string]: ModelSchema;
}

class ReadonlyPrivateMap {
  private map = new WeakMap();

  constructor(private desc: string, private type: string) {}

  init<S extends ModelSchemas>(key: Store<S>, value: Index<S>): void {
    if (this.map.has(key)) {
      throw new Error("Can only initialize private state once");
    }

    this.map.set(key, value);
  }

  get<S extends ModelSchemas>(key: Store<S>): Index<S> {
    if (!this.map.has(key)) {
      throw new Error(`#${this.desc} is only available on ${this.type}`);
    }

    return this.map.get(key);
  }
}

const INDEX = new ReadonlyPrivateMap("index", "Store");

type PropertyTags<S extends ModelSchema> = {
  [P in keyof S["properties"]]: TagWrapper<DirtyableTag>
};

class Index<S extends ModelSchemas> {
  readonly registrations: { [K in keyof S]?: Registration<S[K]> } = {};
  readonly properties: { [K in keyof S]?: Dict<S[K]["properties"]> } = {};
  readonly propertyTags: { [K in keyof S]?: Dict<PropertyTags<S[K]>> } = {};

  register<K extends keyof S>(type: K, registration: Registration<S[K]>): void {
    this.registrations[type] = registration;
  }

  idFor<K extends keyof S>(
    type: K,
    _entity: ModelProperties<S[K]>
  ): S[K]["id"] {
    let registration = this.registrations[type];

    if (registration === undefined) {
      throw new Error(`Unexpected entity type ${type}`);
    } else {
      switch (registration.key) {
        case Key.Singleton:
          return { keyType: Key.Singleton, value: type } as S[K]["id"];

        default:
          throw new Error(
            `Unimplemented keyFor for ${
              registration.key
            } key type (${JSON.stringify(registration)})`
          );
      }
    }
  }

  keyType<K extends keyof S>(type: K): S[K]["id"]["keyType"] {
    let registration = this.registrations[type];

    if (registration === undefined) {
      throw new Error(`Unexpected entity type ${type}`);
    } else {
      return registration.key;
    }
  }

  insert<K extends keyof S>(
    key: QualifiedId<S, K>,
    data: ModelProperties<S[K]>
  ): void {
    let properties = this.properties[key.type] as Dict<ModelProperties<S[K]>>;
    let propertyTags = this.propertyTags[key.type] as Dict<PropertyTags<S[K]>>;

    if (!properties) {
      properties = dict();
      this.properties[key.type] = properties;

      propertyTags = dict();
      this.propertyTags[key.type] = propertyTags;
    }

    properties[key.id.value] = data;
    propertyTags[key.id.value] = mapObject(data, () => DirtyableTag.create());
  }

  patch<K extends keyof S>(
    key: QualifiedId<S, K>,
    updates: Partial<ModelProperties<S[K]>>
  ): void {
    let properties: Dict<S[K]["properties"]> | undefined = this.properties[
      key.type
    ];

    if (!properties) {
      throw new Error(
        `Unexpected patch of un-inserted ${key.type} id=${
          key.id.value
        } (no entities of that type found)`
      );
    }

    let existing = properties[key.id.value];
    let updated = { ...existing, ...updates };

    properties[key.id.value] = updated;

    let tags = this.propertyTags[key.type]![key.id.value]!;

    for (let key of keys(updates)) {
      tags[key].inner!.dirty();
    }
  }

  get<K extends keyof S>(type: K, id: string): Option<ModelProperties<S[K]>> {
    let properties = this.properties[type];

    if (properties === undefined) {
      throw new Error(`unexpected entity type ${type}`);
    } else if (properties[id] === undefined) {
      return null;
    } else {
      return properties[id]!;
    }
  }

  entityTag<K extends keyof S>(_id: QualifiedId<S, K>): Tag {
    return CONSTANT_TAG;
  }

  propertyTag<K extends keyof S, P extends keyof S[K]["properties"]>(
    id: QualifiedId<S, K>,
    key: P
  ): Tag {
    let tags = this.propertyTags[id.type]![id.id.value]!;
    return tags[key];
  }

  derived<K extends keyof S, D extends keyof S[K]["derived"]>(
    type: K,
    name: D
  ): (data: S[K]["properties"]) => unknown {
    let registration = this.registrations[type];

    if (registration === undefined) {
      throw new Error(`Unexpected entity type ${type}`);
    } else {
      return registration.derived[name as string] as any;
    }
  }
}

export class Store<S extends ModelSchemas> {
  constructor() {
    INDEX.init(this, new Index());
  }

  table(_table: Table): void {
    return null as any;
  }

  register<K extends keyof S>(kind: K, registration: Registration<S[K]>): void {
    INDEX.get(this).register(kind, registration);
  }

  insert<K extends keyof S>(
    type: K,
    entity: ModelProperties<S[K]>
  ): QualifiedId<S, K> {
    let index = INDEX.get(this);
    let id = index.idFor(type, entity);
    let qualifiedId = { type, id };

    index.insert(qualifiedId, entity);

    return qualifiedId;
  }

  patch<K extends keyof S>(
    qualifiedId: QualifiedId<S, K>,
    entity: Partial<ModelProperties<S[K]>>
  ): void {
    INDEX.get(this).patch(qualifiedId, entity);
  }

  get<K extends keyof S>(
    qualifiedId: QualifiedId<S, K>
  ): ModelProperties<S[K]> {
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

  peek<K extends keyof S>(
    qualifiedId: QualifiedId<S, K>
  ): Option<ModelProperties<S[K]>> {
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

  derived<K extends keyof S, D extends keyof S[K]["derived"]>(
    id: QualifiedId<S, K>,
    name: D
  ): DerivedFunction<S[K]["derived"][D]> {
    let index = INDEX.get(this);
    let derived = index.derived(id.type, name);

    return (() => derived(this.get(id))) as any;
  }

  entityTag<K extends keyof S>(id: QualifiedId<S, K>): Tag {
    return INDEX.get(this).entityTag(id);
  }

  propertyTag<K extends keyof S, P extends keyof S[K]["properties"]>(
    id: QualifiedId<S, K>,
    key: P
  ): Tag {
    return INDEX.get(this).propertyTag(id, key);
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
