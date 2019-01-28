import { module, test } from "./support";
import { Database, Id, ModelSchemas, Key, EntityReference } from "core-storage";

interface SimpleSchema extends ModelSchemas {
  entities: {
    person: SimplePerson;
  };
}

interface SimplePerson {
  id: Id;
  properties: {
    name: string;
  };

  derived: {
    length(): number;
  };
}

@module
export class SimpleSingletonTests {
  private store = new Database<SimpleSchema>();

  constructor() {
    this.store.register("person", {
      key: Key.Singleton,
      derived: {
        length(person) {
          return person.name.length;
        }
      }
    });
  }

  @test "a simple singleton entity"(assert: Assert) {
    let { store } = this;

    let tomId = store.insert("person", { name: "Tom Dale" });
    let tom = store.get(tomId);
    assert.equal(tom.name, "Tom Dale");

    let derived = store.derived(tomId, "length");
    assert.equal(derived.value(), "Tom Dale".length);
  }

  @test "a simple singleton entity has the right tags"(assert: Assert) {
    let { store } = this;

    let tomId = store.insert("person", { name: "Tom Dale" });
    let tomTag = store.entityTag(tomId);
    let tomNameTag = store.propertyTag(tomId, "name");

    let tom = store.get(tomId);
    let length = store.derived(tomId, "length");

    assert.equal(tom.name, "Tom Dale");
    assert.equal(length.value(), "Tom Dale".length);

    let tomVersion = tomTag.value();
    let tomNameVersion = tomNameTag.value();

    store.patch(tomId, { name: "Thomas Dale" });

    assert.equal(tomTag.validate(tomVersion), false);
    assert.equal(tomNameTag.validate(tomNameVersion), false);

    assert.equal(tom.name, "Tom Dale", "The old checkout doesn't change");
    assert.equal(
      store.get(tomId).name,
      "Thomas Dale",
      "New checkouts see the updates"
    );

    assert.equal(length.value(), "Thomas Dale".length);
  }

  @test "derived state has the right tags"(assert: Assert) {
    let { store } = this;

    let tomId = store.insert("person", { name: "Tom Dale" });

    let length = store.derived(tomId, "length");

    let lengthTag = length.tag;
    assert.equal(
      length.value(),
      "Tom Dale".length,
      "initial derived value is correct"
    );
    let lengthVersion = lengthTag.value();

    store.patch(tomId, { name: "Thomas Dale" });

    assert.equal(
      lengthTag.validate(lengthVersion),
      false,
      "derived tag is invalidated after patching the entity"
    );
    assert.equal(
      length.value(),
      "Thomas Dale".length,
      "derived value is updated after patching the entity"
    );
  }
}

interface AtomicSchema extends ModelSchemas {
  entities: {
    person: AtomicPerson;
    article: AtomicArticle;
  };

  queries: {};
}

interface AtomicPerson {
  id: Id;
  properties: {
    name: string;
    association: string;
  };
}

interface AtomicArticle {
  id: Id;
  properties: {
    title: string;
    author: EntityReference<AtomicSchema, "person">;
    body: string;
    tags: string[];
  };

  derived: {
    byline(): string;
    simpleTags(): string[];
  };
}

@module
export class AtomicSingletonTests {
  private store = new Database<AtomicSchema>();
  private personId: EntityReference<AtomicSchema, "person">;
  private articleId: EntityReference<AtomicSchema, "article">;

  constructor() {
    this.store.register("person", {
      key: Key.Singleton
    });

    this.store.register("article", {
      key: Key.Singleton,

      derived: {
        byline(article, database) {
          let author = database.get(article.author);
          return `${author.name} (${author.association})`;
        }
      }
    });

    this.personId = this.store.insert("person", {
      name: "Yehuda Katz",
      association: "Tilde"
    });

    this.articleId = this.store.insert("article", {
      title: "Hello world",
      author: this.personId,
      body: "This is a whole new world. A brand new place for you and me.",
      tags: []
    });
  }

  @test "derived state through associations works"(assert: Assert) {
    let { store } = this;

    let yehuda = store.get(this.personId);
    assert.equal(yehuda.name, "Yehuda Katz");
    assert.equal(yehuda.association, "Tilde");

    let byline = store.derived(this.articleId, "byline");

    assert.equal(byline.value(), `Yehuda Katz (Tilde)`);
  }

  @test "derived state through associations has the right tags"(
    assert: Assert
  ) {
    let { store } = this;

    let yehuda = store.get(this.personId);
    assert.equal(yehuda.name, "Yehuda Katz");
    assert.equal(yehuda.association, "Tilde");

    let byline = store.derived(this.articleId, "byline");

    assert.equal(byline.value(), `Yehuda Katz (Tilde)`);

    let tag = byline.tag;
    let revision = tag.value();

    store.patch(this.personId, { association: "Tilde, Inc." });
    assert.notEqual(
      tag.value(),
      revision,
      "revision was bumped after related entity changed"
    );

    assert.equal(byline.value(), `Yehuda Katz (Tilde, Inc.)`);
  }
}
