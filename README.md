# salsa

An experimental core storage primitive built on Glimmer references and designed for reactivity.

This README is currently aspirational (I'm using README-driven development at the moment).

## Goal

The goal of core-storage is to expose a primitive storage API that satisfies these constraints:

1. Storage is persistent. Once a piece of storage is created, it remains in memory until it is deleted.
2. Lifetime management is automatic. If you want your storage to automatically be deleted once the component it was created for is destroyed, you can express that directly.

## Entity

An entity is a group of fields that contain only primitive data.

```ts
let database = new Database();

database.register("person", {
  key: Key.UUID
});

// `{ name: "Godfrey Chan" }` is inserted into the database as a `person`, and
// a key is returned that can be used to index into the database. Because we
// said that `person`'s key is a UUID, core-storage creates a UUID for us.
let godfreyKey = database.insert("person", { name: "Godfrey Chan" });

// Fetch the object associated with the ID.
let godfrey = database.checkout(godfreyKey);

assert(godfrey.name === "Godfrey Chan"); // the data was returned
```

An entity is updated atomically. Any data that you got through `checkout` is a
snapshot of the data.

```ts
let godfrey = database.checkout(godfreyKey);

database.patch(godfreyKey, { name: "Godfrey 'chancancode' Chan" });

// the original checkout hasn't changed
assert(godfrey.name, "Godfrey Chan");

// but you can get a new checkout
let updatedGodfrey = database.checkout(godfreyKey);

// and the new checkout sees the update
assert(godfrey.name, "Godfrey 'chancancode' Chan");
```

## Freshness

You can check whether a particular checkout is fresh by asking the database for
the current revision for a particular entity.

```ts
let godfrey = database.checkout(godfreyKey);

// get the most recent revision of godfreyKey
let head = database.revision(godfreyKey);

// the most recent revision is still up to date
assert(database.validate(godfreyKey, head) === true);

// update godfrey in the database
database.patch(godfreyKey, { name: "Godfrey 'chancancode' Chan" });

// the earlier revision is no longer up to date
assert(database.validate(godfreyKey, head) === false);

// and a new checkout will get the newer data
assert(database.checkout(godfreyKey).name === "Godfrey 'chancancode' Chan");
```

> Under the hood, core-storage uses Glimmer's tag interface. If you're familiar
> with that interface, or if you need a tag for some reason, you can ask for
> one via `database.entityTag(godfreyKey)` instead of using the revision and
> validate methods on the store. The revision and validate methods use tags
> under the hood, so the two uses are equivalent.

## Queries

While working with atomic data is nice, you also want the ability to do
computations against the data in the database.

Because the data in the database is just raw JavaScript values, you can
write normal functions to compute things.

```ts
let database = new Database();

database.register("person", {
  key: Key.UUID
});

let godfreyKey = database.insert("person", { name: "Godfrey Chan" });

function upcaseName(database, personKey) {
  let person = database.checkout(personKey);

  return person.name.toUpperCase();
}
```

This works as intended, but you have no way to know whether `upcaseName` for
a given person is still fresh without re-running the function.

To make it possible to answer that question efficiently, you can turn the
function into a **query**.

```ts
let database = new Database({
  queries: {
    upcase(database, personKey) {
      let person = database.checkout(personKey);
      return person.name.toUpperCase();
    }
  }
});

database.register("person", {
  key: Key.UUID
});

let godfreyKey = database.insert("person", { name: "Godfrey Chan" });

// get an `upcase` query for godfrey
let godfreyCaps = database.query("upcase", godfreyKey);

// the value of the query is the result of executing the query against the
// parameters to the query.
assert(godfreyCaps.value() === "GODFREY CHAN");

// to check whether the last value we computed for godfreyCaps is still fresh
// pull off its tag.
let godfreyCapsTag = godfreyCaps.tag;

// call `value()` on the tag to get the current revision of the computation;
// this is the maximum of all of the revisions of the entities the
// computation used.
let head = godfreyCapsTag.value();

// update the entity
database.patch(godfreyKey, { name: "Godfrey 'chancancode' Chan" });

// since the godfrey entity was used in the last computation of this query,
// and since it was updated, the tag reports that the value is stale.
assert(godfreyCapsTag.validate(revision) === false);

assert(godfreyCaps.value() === "GODFREY 'CHANCANCODE' CHAN");
```

## Namespaced Queries

While it's possible to register all computed values on the database, if a
query is operating on a particular entity type, it can be convenient to
namespace them together with the entity.

This is useful both for namespacing purposes, and to make it easy to defer
loading an entity's queries until the entity itself is needed.

```ts
let database = new Database();

database.register("person", {
  key: Key.UUID,

  queries: {
    upcase(database, personKey) {
      let person = database.checkout(personKey);
      return person.name.toUpperCase();
    }
  }
});

let godfreyKey = database.insert("person", { name: "Godfrey Chan" });

// the query is now namespaced together with the entity. Otherwise, nothing
// else changes.
let godfreyCaps = database.query("person", "upcase", godfreyKey);

assert(godfreyCaps.value() === "GODFREY CHAN");

let godfreyCapsTag = godfreyCaps.tag;
let head = godfreyCapsTag.value();

database.patch(godfreyKey, { name: "Godfrey 'chancancode' Chan" });

assert(godfreyCapsTag.validate(revision) === false);
assert(godfreyCaps.value() === "GODFREY 'CHANCANCODE' CHAN");
```

## Whole Table Queries

So far, our queries have always been operating on a single entity.

What if we want to write a query that filters "person" based on whether they're
contributors to our project. Let's first do it by hand.

```ts
let database = new Database();

database.register("person", {
  key: Key.UUID
});

database.insert("person", { name: "Godfrey Chan", contributor: true });
database.insert("person", { name: "Tom Dale", contributor: true });
database.insert("person", { name: "Dan Abramov", contributor: false });
database.insert("person", { name: "Igor Minar", contributor: false });
database.insert("person", { name: "Yehuda Katz", contributor: true });

function contributors(database) {
  return database.all("person").filter(key => database.get(key).contributor);
}

let actual = contributors(database).map(key => database.get(key).name);
let expected = ["Godfrey Chan", "Tom Dale", "Yehuda Katz"];

assert(JSON.stringify(actual) === JSON.stringify(expected));
```

Just like before, we can register this query and get freshness information:

```ts
let database = new Database({
  queries: {
    contributors(database) {
      return database
        .all("person")
        .filter(key => database.get(key).contributor);
    }
  }
});

database.register("person", {
  key: Key.UUID
});

database.insert("person", { name: "Godfrey Chan", contributor: true });
database.insert("person", { name: "Tom Dale", contributor: true });
database.insert("person", { name: "Dan Abramov", contributor: false });
database.insert("person", { name: "Igor Minar", contributor: false });

let yehuda = database.insert("person", {
  name: "Yehuda Katz",
  contributor: true
});

let contributors = database.query("contributors");

equiv(contributors.value(), ["Godfrey Chan", "Tom Dale", "Yehuda Katz"]);

let contributorsTag = contributors.tag;
let head = contributorsTag.value();

database.insert("person", { name: "Melanie Sumner", contributor: true });

assert(contributorsTag.validate(head) === false);
equiv(contributors.value(), [
  "Godfrey Chan",
  "Tom Dale",
  "Yehuda Katz",
  "Melanie Sumner"
]);

head = contributorsTag.value();

database.patch(yehuda, { contributor: false }); // :scream:

assert(contributorsTag.validate(head) === false);
equiv(contributors.value(), ["Godfrey Chan", "Tom Dale", "Melanie Sumner"]);
```

## Modelling Relationships

Let's say we have the canonical "hello world" of relationships: articles that
have many comments.

Let's model that so that each comment holds a reference to an article.

```ts
let database = new Database();

database.register("article", {
  key: Key.UUID,

  queries: {
    comments(database, articleKey) {
      return database
        .all("comment")
        .map(comment => database.checkout(comment))
        .filter(comment => comment.article === articleKey);
    }
  }
});

database.register("comment", {
  key: Key.UUID
});

let article1 = database.insert("article", {
  title: "Hello world",
  body: "Hi there!"
});

database.insert("comment", {
  body: "Right back atcha",
  article: article1
});

database.insert("comment", {
  body: "Hey I wanted to be *first*",
  article: article1
});

let comments = database.query("article", "comments", article1);

let commentsTag = comments.tag;
let head = commentsTag.value();

equiv(comments, [
  { body: "Right back atcha", article: article1 },
  { body: "Hey I wanted to be *first*", article: article1 }
]);

database.insert("comment", {
  body: "Stop fighting you two!",
  article: article1
});

assert(commentsTag.validate(head) === false);

equiv(comments.value(), [
  { body: "Right back atcha", article: article1 },
  { body: "Hey I wanted to be *first*", article: article1 }.
  { body: "Stop fighting you two!", article: article1 }
]);
```
