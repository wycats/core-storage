import { module, test } from "./support";

@module
export class SingletonTests {
  @test "a simple singleton record"(assert: Assert) {
    assert.ok(true);
  }
}
