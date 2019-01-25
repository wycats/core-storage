import { ModelSchemas } from "./store";

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

export interface QualifiedId<S extends ModelSchemas, K extends keyof S> {
  type: K;
  id: S[K]["id"];
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
