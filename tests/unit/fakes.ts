/** Builds an object whose listed methods are jest mocks, typed as the real class. */
export function mockOf<T>(...methods: (keyof T)[]): jest.Mocked<T> {
  return Object.fromEntries(methods.map((m) => [m, jest.fn()])) as unknown as jest.Mocked<T>;
}
