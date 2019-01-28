import { ModelSchemas, EntityId, EntityName } from "./database";

export interface Table<R extends Row = Row> {
  new (...args: any[]): R;
}

export interface Row {
  key: Key;
}

export const enum Key {
  Singleton = "Singleton",
  UUID = "UUID"
}

export interface EntityReference<
  S extends ModelSchemas,
  K extends EntityName<S>
> {
  type: K;
  id: EntityId<S, K>;
}

export type Id<I extends string = string> =
  | { keyType: Key.Singleton; value: I }
  | { keyType: Key.UUID; value: I };

const DATA = new WeakMap<object, Set<string>>();
const DERIVED = new WeakMap<object, Set<string>>();

export function data(target: object, name: string) {
  let data = DATA.get(target);

  if (!data) {
    data = new Set();
    DATA.set(target, data);
  }

  data.add(name);
}

export function derived(target: object, name: string) {
  let data = DERIVED.get(target);

  if (!data) {
    data = new Set();
    DERIVED.set(target, data);
  }

  data.add(name);
}
