# salsa

An experimental core storage primitive built on Glimmer references and designed for reactivity.

This README is currently aspirational (I'm using README-driven development at the moment).

## Goal

The goal of core-storage is to expose a primitive storage API that satisfies these constraints:

1. Storage is persistent. Once a piece of storage is created, it remains in memory until it is deleted.
2. Lifetime management is automatic. If you want your storage to automatically be deleted once the component it was created for is destroyed, you can express that directly.

## Table

The basic primitive of core-storage is the storage table. A storage table can be keyed (if there are multiple rows in the table, indexed by key) or singleton (if there is only one instance of the table).

> A singleton table can be thought of as a keyed table whose only instance has the key `null`.

### The Store

A singleton table:

```ts
let store = new Store();

store.table("person", {
  key: Key.Singleton,
  data: ["name"],

  computed: {
    length(person: Row<Person>) {
      return person.name.length;
    }
  }
});

function main() {
  let store = new Store();

  store.set('person', {
    name: "Tom Dale"
  });

  let person = store.get('person');

  console.log("Initially, the length is", person.length);

  // this is representative of what Ember would do in this situation, but it's
  // not something you would likely do in your own code.
  let tag = store.tagFor(person, 'name');
  let revision = tag.value();

  person.name = "Hello world");

  tag.validate(revision); // false

  console.log("Now, the length is", person.length);
}
```

A keyed table:

```ts
let store = new Store();

store.table("person", {
  key: Key.UUID,
  data: ["name"],

  computed: {
    length(person: Row<Person>) {
      return person.name.length;
    }
  },

  queries: {
    dales(people: Table<Person>) {
      return people.all().filter(p => /Dale$/.test(p));
    }
  }
});

function main() {
  let store = new Store();

  let id = store.set("person", {
    data: {
      name: "Tom Dale"
    }
  });

  let tom = store.get("person", id);
  let tomTag = store.dataTag(tom, "name");
  let tomRevision = tomTag.value();

  console.log("Initially, the length is", person.length);

  let people = store.queries("person");
  let dales = people.dales();
  let peopleTag = store.queriesTag("person", "dales");
  let peopleRevision = peopleTag.value();

  console.log("Initially, Dales has", people);

  store.patch(tom, {
    name: "Tom Dall"
  });

  assert(tomTag.validate(tomRevision) === false);
  assert(peopleTag.valiate(peopleRevision) === false);

  assert.deepEqual(people.dales(), []);
}
```

### Singleton Table

```ts
import { storage, cell, query, Store } from "core-storage";

@storage
class Person {
  @cell name: string = "";

  @query
  length() {
    return this.name.length;
  }
}

function main() {
  let store = new Store();

  let person = store.register(new Person());

  console.log("Initially, the length is", person.length);

  // this is representative of what Ember would do in this situation, but it's
  // not something you would likely do in your own code.
  let tag = tagFor(person, 'name');
  let revision = tag.value();

  person.name = "Hello world");

  tag.validate(revision); // false

  console.log("Now, the length is", person.length);
}
```

### Keyed Table

```ts
import { storage, cell, key, table, query } from "core-storage";

@storage
class Person {
  @key id: string;
  @cell name: string;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  @query
  length() {
    return this.name.length;
  }
}

@table(Person)
class People {
  @query
  dales(people: Table<Person>) {
    return people.all().filter(p => /Dale$/.test(p.name));
  }
}

function main() {
  let store = new Store();

  let person = store.register(new Person(1, "Tom Dale"));
  let people = store.query(People);

  console.log("Initially, the Dales is", people.dales());

  // this is representative of what Ember would do in this situation, but it's
  // not something you would likely do in your own code.
  let tag = tagFor(person, 'name');
  let revision = tag.value();

  person.name = "Hello world");

  tag.validate(revision); // false

  console.log("Now, the length is", person.length);
}
```
