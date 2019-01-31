import {
  consume,
  DirtyableTag,
  TagWrapper,
  UpdatableDirtyableTag
} from "@glimmer/reference";
import { Dict, dict, keys, Option } from "ts-std";
import {
  DatabaseSchema,
  Derived,
  EntityName,
  EntityReference,
  Properties,
  PropertiesFor
} from "./schema";

export class TypeIndexRecord<
  S extends DatabaseSchema,
  K extends EntityName<S>
> {
  readonly entities: Dict<Entity<S, K>> = dict();
  readonly allTag: TagWrapper<DirtyableTag> = DirtyableTag.create();
  readonly branches: Set<number> = new Set();

  eachEntity(callback: (item: Entity<S, K>, key: string) => void) {
    for (let key of Object.keys(this.entities)) {
      callback(this.entities[key]!, key);
    }
  }

  insert(key: EntityReference<K>, data: Properties<S, K>): void {
    this.entities[key.id.value] = new Entity(data);

    this.allTag.inner.dirty();
  }

  getEntityTags(id: string): Option<Entity<S, K>> {
    if (id in this.entities) {
      return this.entities[id]!;
    } else {
      return null;
    }
  }

  getProperties(id: string): Option<PropertiesFor<K>> {
    return this.entities[id]!.getProperties();
  }

  patchProperties(id: string, updates: Partial<PropertiesFor<K>>): void {
    this.entities[id]!.patchProperties(updates);
    this.allTag.inner.dirty();
  }
}

export class Entity<S extends DatabaseSchema, K extends EntityName<S>> {
  private properties: PropertiesFor<K>;
  private propertyTags: Map<
    keyof Properties<S, K>,
    TagWrapper<DirtyableTag>
  > = new Map();

  private entityTag = DirtyableTag.create();
  private derivedTags: Map<
    keyof Derived<S, K>,
    TagWrapper<UpdatableDirtyableTag>
  > = new Map();

  constructor(properties: Properties<S, K>) {
    this.properties = properties;

    let { propertyTags: map } = this;

    keys(properties).forEach(key => {
      map.set(key, DirtyableTag.create());
    });
  }

  patchProperties(updates: Partial<PropertiesFor<K>>): void {
    this.properties = { ...this.properties, ...updates };
    this.dirty(updates);
  }

  consume(): void {
    consume(this.entityTag);
  }

  consumeProperty(key: keyof Properties<S, K>): void {
    consume(this.propertyTags.get(key)!);
  }

  getProperty<P extends keyof Properties<S, K>>(key: P): Properties<S, K>[P] {
    return this.properties[key];
  }

  getProperties(): Properties<S, K> {
    return this.properties;
  }

  getPropertyTag(key: keyof Properties<S, K>): TagWrapper<DirtyableTag> {
    return this.propertyTags.get(key)!;
  }

  getDerivedTag(key: keyof Derived<S, K>): TagWrapper<UpdatableDirtyableTag> {
    if (this.derivedTags.has(key)) {
      return this.derivedTags.get(key)!;
    } else {
      let tag = UpdatableDirtyableTag.create();
      this.derivedTags.set(key, tag);
      return tag;
    }
  }

  entity(): TagWrapper<DirtyableTag> {
    return this.entityTag;
  }

  dirty(data: Partial<Properties<S, K>>): void {
    for (let key of keys(data)) {
      if (this.propertyTags.has(key)) {
        this.propertyTags.get(key)!.inner.dirty();
      }
    }

    this.entityTag.inner.dirty();
  }

  dirtyAll(): void {
    for (let value of this.propertyTags.values()) {
      value.inner.dirty();
    }

    this.entityTag.inner.dirty();
  }
}
