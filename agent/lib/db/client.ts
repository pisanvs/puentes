import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Local file by default; point DATABASE_URL at Turso to deploy.
const client = createClient({
  url: process.env.DATABASE_URL ?? "file:puentes.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
export { schema };
