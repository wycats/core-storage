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
