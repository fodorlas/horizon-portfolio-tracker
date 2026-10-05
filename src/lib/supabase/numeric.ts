/**
 * The type generator maps Postgres `numeric` to `number`, but amounts are sent
 * as exact decimal strings (PostgREST casts them). Never pass a float here.
 */
export const numeric = (decimal: string) => decimal as unknown as number;
