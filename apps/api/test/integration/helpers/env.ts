export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://localstripe:localstripe@localhost:55432/localstripe_test';

/** The suite drops the whole schema, so it refuses to run against anything but a test database. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) {
    throw new Error(`Refusing to run integration tests against non-test database "${name}".`);
  }
}
