import { module, test } from "./support";
import { Store, Id, ModelSchemas, Key } from "core-storage";

interface Schema extends ModelSchemas {
  person: Person;
}

interface Person {
  id: Id;
  properties: {
    name: string;
  };

  derived: {
    length(): number;
  };
}

@module
export class SingletonTests {
  @test "a simple singleton entity"(assert: Assert) {
    let store = new Store<Schema>();

    store.register("person", {
      key: Key.Singleton,
      derived: {
        length(person) {
          return person.name.length;
        }
      }
    });

    let tomId = store.insert("person", { name: "Tom Dale" });
    let tom = store.get(tomId);
    assert.equal(tom.name, "Tom Dale");

    let derived = store.derived(tomId, "length");
    assert.equal(derived(), "Tom Dale".length);
  }

  @test "a simple singleton entity has the right tags"(assert: Assert) {
    let store = new Store<Schema>();

    store.register("person", {
      key: Key.Singleton,
      derived: {
        length(person) {
          return person.name.length;
        }
      }
    });

    let tomId = store.insert("person", { name: "Tom Dale" });
    // let tomTag = store.entityTag(tomId);
    let tomNameTag = store.propertyTag(tomId, "name");

    let tom = store.get(tomId);
    let length = store.derived(tomId, "length");

    assert.equal(tom.name, "Tom Dale");
    assert.equal(length(), "Tom Dale".length);

    // let tomVersion = tomTag.value();
    let tomNameVersion = tomNameTag.value();

    store.patch(tomId, { name: "Thomas Dale" });

    // assert.equal(tomTag.validate(tomVersion), false);
    assert.equal(tomNameTag.validate(tomNameVersion), false);

    assert.equal(tom.name, "Tom Dale", "The old checkout doesn't change");
    assert.equal(
      store.get(tomId).name,
      "Thomas Dale",
      "New checkouts see the updates"
    );

    assert.equal(length(), "Thomas Dale".length);
  }
}
