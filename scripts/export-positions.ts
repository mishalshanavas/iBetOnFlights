import { writeFile } from "node:fs/promises";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { positions } from "@/lib/db/schema";
async function main(){const path=process.argv[2]||"positions-export.json";if(!path.endsWith(".json"))throw new Error("Use a .json output path; convert to Parquet with ml/export_parquet.py.");const db=await getDb();const rows=await db.select().from(positions).orderBy(asc(positions.observedAt));await writeFile(path,JSON.stringify(rows,null,2),"utf8");console.log(`Exported ${rows.length} real position observations to ${path}.`);}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
