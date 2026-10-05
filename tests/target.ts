/** Database tests in this repository may connect only to a local Supabase. */
export type TestTarget = "local";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function testTarget(address: string | undefined): TestTarget {
  if (!address) throw new Error("The Supabase address is not set");
  let host: string;
  try {
    host = new URL(address).hostname;
  } catch {
    throw new Error("Refusing to run tests against anything but local Supabase");
  }
  if (LOOPBACK.has(host)) return "local";
  throw new Error("Refusing to run tests against anything but local Supabase");
}

export function requireLocal(address: string | undefined): void {
  if (testTarget(address) !== "local") throw new Error("Tests require a local Supabase instance");
}
