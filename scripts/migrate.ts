import "@/lib/db/index";
import { getDb } from "@/lib/db";
async function main(){await getDb();console.log("SQLite migration applied; airport metadata seeded.");}
main().catch(()=>{console.error("Migration failed. Verify DATABASE_URL and DATABASE_AUTH_TOKEN.");process.exitCode=1;});
