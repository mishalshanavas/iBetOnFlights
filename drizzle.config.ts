// Informational connection configuration. SQL migrations use scripts/migrate.ts.
export default {schema: "./lib/db/schema.ts", out: "./drizzle", dialect: "turso", dbCredentials: {url: process.env.DATABASE_URL || "file:./data/flightguard.db", authToken: process.env.DATABASE_AUTH_TOKEN}};
