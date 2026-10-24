import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: "./agent/lib/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:puentes.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
});
