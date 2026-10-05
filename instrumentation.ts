import { readAppMode } from "./src/lib/demo/config";

/** Validate runtime environment before the server begins accepting requests. */
export function register() {
  readAppMode(process.env);
}
