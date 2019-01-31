import { module, test } from "./support";
import {
  Database,
  Id,
  DatabaseSchema,
  KeyType,
  EntityReference,
  Queries
} from "core-storage";
import { Option } from "ts-std";

interface SimpleSchema extends DatabaseSchema {
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
      key: KeyType.UUID,
      derived: {
        length(person) {
          return person.name.length;
        }
      }
    });
  }

  @test "a simple entity"(assert: Assert) {
    let { store } = this;

    let tomId = store.insert("person", { name: "Tom Dale" });
    let tom = store.checkout(tomId);
    assert.equal(tom.name, "Tom Dale");

    let derived = store.query(tomId, "length");
    assert.equal(derived.value(), "Tom Dale".length);
  }

  @test "two instances"(assert: Assert) {
    let { store } = this;

    let tomId = store.insert("person", { name: "Tom Dale" });
    let tom = store.checkout(tomId);
    assert.equal(tom.name, "Tom Dale");

    let yehudaId = store.insert("person", { name: "Yehuda Katz" });
    let yehuda = store.checkout(yehudaId);
    assert.equal(yehuda.name, "Yehuda Katz");

    assert.notEqual(tomId.id.value, yehudaId.id.value);

    let tomLength = store.query(tomId, "length");
    assert.equal(tomLength.value(), "Tom Dale".length);

    let yehudaLength = store.query(yehudaId, "length");
    assert.equal(yehudaLength.value(), "Yehuda Katz".length);
  }

  @test "two instances don't share tags"(assert: Assert) {
    let { store } = this;

    let tomId = store.insert("person", { name: "Tom Dale" });
    let tom = store.checkout(tomId);
    let tomTag = store.entityTag(tomId);
    let tomNameTag = store.propertyTag(tomId, "name");

    let yehudaId = store.insert("person", { name: "Yehuda Katz" });
    let yehuda = store.checkout(yehudaId);
    let yehudaTag = store.entityTag(yehudaId);
    let yehudaNameTag = store.propertyTag(yehudaId, "name");

    let tomLength = store.query(tomId, "length");
    let yehudaLength = store.query(yehudaId, "length");

    assert.equal(tom.name, "Tom Dale", "initial name is correct");
    assert.equal(
      tomLength.value(),
      "Tom Dale".length,
      "initial length (Tom) is correct"
    );

    assert.equal(yehuda.name, "Yehuda Katz", "initial name is correct");
    assert.equal(
      yehudaLength.value(),
      "Yehuda Katz".length,
      "initial length (Yehuda) is correct"
    );

    let tomVersion = tomTag.value();
    let tomNameVersion = tomNameTag.value();

    let yehudaVersion = tomTag.value();
    let yehudaNameVersion = tomNameTag.value();

    store.patch(tomId, { name: "Thomas Dale" });
    store.patch(yehudaId, { name: "Yehuda S. Katz" });

    assert.equal(
      tomTag.validate(tomVersion),
      false,
      "entity tag changes after patch"
    );
    assert.equal(
      tomNameTag.validate(tomNameVersion),
      false,
      "property tag changes after update"
    );

    assert.equal(
      yehudaTag.validate(yehudaVersion),
      false,
      "entity tag changes after patch"
    );
    assert.equal(
      yehudaNameTag.validate(yehudaNameVersion),
      false,
      "property tag changes after update"
    );

    assert.equal(tom.name, "Tom Dale", "The old checkout doesn't change");
    assert.equal(yehuda.name, "Yehuda Katz", "The old checkout doesn't change");

    assert.equal(
      store.checkout(tomId).name,
      "Thomas Dale",
      "New checkouts see the updates"
    );

    assert.equal(
      store.checkout(yehudaId).name,
      "Yehuda S. Katz",
      "New checkouts see the updates"
    );

    assert.equal(
      tomLength.value(),
      "Thomas Dale".length,
      "derived references update"
    );
    assert.equal(
      yehudaLength.value(),
      "Yehuda S. Katz".length,
      "derived references update"
    );
  }

  @test "derived state has the right tags"(assert: Assert) {
    let { store } = this;

    let tomId = store.insert("person", { name: "Tom Dale" });
    let yehudaId = store.insert("person", { name: "Yehuda Katz" });

    let tomLength = store.query(tomId, "length");
    let yehudaLength = store.query(yehudaId, "length");

    let tomLengthTag = tomLength.tag;
    assert.equal(
      tomLength.value(),
      "Tom Dale".length,
      "initial derived value is correct"
    );
    let tomLengthVersion = tomLengthTag.value();

    let yehudaLengthTag = tomLength.tag;
    assert.equal(
      yehudaLength.value(),
      "Yehuda Katz".length,
      "initial derived value is correct"
    );
    let yehudaLengthVersion = yehudaLengthTag.value();

    store.patch(tomId, { name: "Thomas Dale" });
    store.patch(yehudaId, { name: "Yehuda S. Katz" });

    assert.equal(
      tomLengthTag.validate(tomLengthVersion),
      false,
      "derived tag is invalidated after patching the entity"
    );

    assert.equal(
      yehudaLengthTag.validate(yehudaLengthVersion),
      false,
      "derived tag is invalidated after patching the entity"
    );

    assert.equal(
      tomLength.value(),
      "Thomas Dale".length,
      "derived value is updated after patching the entity"
    );

    assert.equal(
      yehudaLength.value(),
      "Yehuda S. Katz".length,
      "derived value is updated after patching the entity"
    );
  }
}

interface AtomicQueries extends Queries {
  articles(
    personKey: EntityReference<"person">
  ): Array<EntityReference<"article">>;
}

interface AtomicSchema extends DatabaseSchema {
  entities: {
    person: AtomicPerson;
    article: AtomicArticle;
  };

  queries: AtomicQueries;
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
    author: Option<EntityReference<"person">>;
    body: string;
    tags: string[];
  };

  derived: {
    byline(): Option<string>;
    simpleTags(): string[];
  };
}

@module
export class AtomicTests {
  private database = new Database<AtomicSchema>({
    articles(
      db: Database<AtomicSchema>,
      personKey: EntityReference<"person">
    ): EntityReference<"article">[] {
      let articles = db.all("article");
      return articles.filter(a => db.checkout(a).author === personKey);
    }
  });
  private personId: EntityReference<"person">;
  private articleId: EntityReference<"article">;

  constructor() {
    this.database.register("person", {
      key: KeyType.UUID
    });

    this.database.register("article", {
      key: KeyType.UUID,

      derived: {
        byline(article, database) {
          if (article.author === null) return null;

          let author = database.checkout(article.author);
          return `${author.name} (${author.association})`;
        }
      }
    });

    this.personId = this.database.insert("person", {
      name: "Yehuda Katz",
      association: "Tilde"
    });

    this.articleId = this.database.insert("article", {
      title: "Hello world",
      author: this.personId,
      body: "This is a whole new world. A brand new place for you and me.",
      tags: []
    });
  }

  @test "derived state through associations works"(assert: Assert) {
    let { database: store } = this;

    let yehuda = store.checkout(this.personId);
    assert.equal(yehuda.name, "Yehuda Katz");
    assert.equal(yehuda.association, "Tilde");

    let byline = store.query(this.articleId, "byline");

    assert.equal(byline.value(), `Yehuda Katz (Tilde)`);
  }

  @test "derived state through associations has the right tags"(
    assert: Assert
  ) {
    let { database: store } = this;

    let yehuda = store.checkout(this.personId);
    assert.equal(yehuda.name, "Yehuda Katz");
    assert.equal(yehuda.association, "Tilde");

    let byline = store.query(this.articleId, "byline");

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

  @test "database-wide queries work"(assert: Assert) {
    let { database } = this;

    let yehuda = database.checkout(this.personId);
    assert.equal(yehuda.name, "Yehuda Katz");
    assert.equal(yehuda.association, "Tilde");

    let articles = database.dbQuery("articles", this.personId);
    let articlesTag = articles.tag;
    let articlesRevision = articlesTag.value();

    assert.deepEqual(articles.value(), [this.articleId]);

    let helloId = database.insert("article", {
      title: "Hello world, second article!",
      author: this.personId,
      body: "It's a mad mad mad mad mad new world",
      tags: []
    });

    assert.equal(articlesTag.validate(articlesRevision), false);
    assert.deepEqual(articles.value(), [this.articleId, helloId]);
    articlesRevision = articlesTag.value();

    database.patch(this.articleId, { author: null });
    assert.equal(articlesTag.validate(articlesRevision), false);
    assert.deepEqual(articles.value(), [helloId]);
  }
}

interface Assert {
  equal<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  notEqual<T>(actual: T, expected: T, message?: string): void;
}
