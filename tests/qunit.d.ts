declare module "qunit" {
  export function test(name: string, callback: (assert: Assert) => void): void;

  export function module(
    name: string,
    hooks?: Hooks,
    nested?: (hooks: NestedHooks) => void
  ): void;
  export function module(
    name: string,
    nested?: (hooks: NestedHooks) => void
  ): void;
}
