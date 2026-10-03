/** Apply SQL migrations from ./drizzle. Usage: pnpm db:migrate  (uses DATABASE_URL) */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

async function main(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log("migrations applied");
  } finally {
    await sql.end();
  }
}

main(url).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
