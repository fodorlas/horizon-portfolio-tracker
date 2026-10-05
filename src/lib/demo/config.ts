export type AppMode = { demo: boolean };

const CONNECTION_VARIABLE = /^(?:NEXT_PUBLIC_SUPABASE_|SUPABASE_)/;
const DATABASE_VARIABLE = /^(?:DATABASE_URL|DB_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|POSTGRES_URL_NON_POOLING|DIRECT_URL)$/;

/** Resolve the server-selected mode and reject database configuration in demo builds. */
export function readAppMode(env: Record<string, string | undefined>): AppMode {
  const demo = env.DEMO_MODE === "true";
  if (env.NEXT_PUBLIC_DEMO_MODE === "true" && !demo) {
    throw new Error("NEXT_PUBLIC_DEMO_MODE requires DEMO_MODE=true on the server.");
  }
  if (!demo) return { demo: false };

  const configured = Object.entries(env).find(
    ([name, value]) => name !== "DEMO_MODE" && (CONNECTION_VARIABLE.test(name) || DATABASE_VARIABLE.test(name)) && Boolean(value?.trim()),
  );
  if (configured) {
    throw new Error(`Demo mode cannot run while Supabase or database configuration is set (${configured[0]}).`);
  }

  return { demo: true };
}
