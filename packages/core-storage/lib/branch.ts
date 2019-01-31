import { Tag, VersionedPathReference } from "@glimmer/reference";
import { Database } from "./database";
import {
  DatabaseSchema,
  Derived,
  DerivedReturn,
  EntityName,
  EntityReference,
  Properties,
  QueriesFor,
  QueryArgs,
  QueryReturn
} from "./schema";

export class Branch<S extends DatabaseSchema> implements Database<S> {
  constructor(readonly inner: Database<S>) {}

  all<K extends EntityName<S>>(_kind: K): Array<EntityReference<K>> {
    throw new Error("unimplemented Branch#all");
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
    _refOrType: K | EntityReference<K>,
    _entity: Properties<S, K>
  ): EntityReference<K> {
    throw new Error("unimplemented Branch#insert");
  }

  delete<K extends EntityName<S>>(_qualifiedId: EntityReference<K>): void {
    throw new Error("unimplemented Branch#delete");
  }

  patch<K extends EntityName<S>>(
    _qualifiedId: EntityReference<K>,
    _entity: Partial<Properties<S, K>>
  ): void {
    throw new Error("unimplemented Branch#patch");
  }

  checkout<K extends EntityName<S>>(
    _qualifiedId: EntityReference<K>
  ): Properties<S, K> {
    throw new Error("unimplemented Branch#checkout");
  }

  query<K extends EntityName<S>, D extends keyof Derived<S, K>>(
    _id: EntityReference<K>,
    _name: D
  ): VersionedPathReference<DerivedReturn<K, D>> {
    throw new Error("unimplemented Branch#query");
  }

  dbQuery<N extends keyof QueriesFor<S>>(
    _name: N,
    ..._args: QueryArgs<S, N>
  ): VersionedPathReference<QueryReturn<S, N>> {
    throw new Error("unimplemented Branch#dbQuery");
  }

  entityTag(_id: EntityReference<EntityName<S>>): Tag {
    throw new Error("unimplemented Branch#entityTag");
  }

  propertyTag<K extends EntityName<S>, P extends keyof Properties<S, K>>(
    _id: EntityReference<K>,
    _key: P
  ): Tag {
    throw new Error("unimplemented Branch#propertyTag");
  }

  derivedTag<K extends EntityName<S>, P extends keyof Derived<S, K>>(
    _id: EntityReference<K>,
    _key: P
  ): Tag {
    throw new Error("unimplemented Branch#derivedTag");
  }

  allTag<K extends EntityName<S>>(_type: K): Tag {
    throw new Error("unimplemented Branch#allTag");
  }
}
