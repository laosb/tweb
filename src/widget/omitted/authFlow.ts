// Token authorization owns startup; bootstrapIm still calls the disposal entry point.
export function disposeActiveAuthFlow(_delay?: number) {}
export function mountAuthFlow(..._args: unknown[]) {
  return {leave: () => Promise.resolve(), back() {}, dispose() {}};
}
