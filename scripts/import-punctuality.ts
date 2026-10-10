import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getTableColumns,sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { publishedPunctuality } from "@/lib/db/schema";
import { findAirport } from "@/data/airports";

const count=z.number().int().nonnegative();
const record=z.object({
  id:z.string().regex(/^caa-[a-f0-9]{40}$/),period:z.string().regex(/^20\d{2}(0[1-9]|1[0-2])$/),
  reportingAirport:z.string().refine(v=>!!findAirport(v)),otherAirport:z.string().refine(v=>!!findAirport(v)),
  airline:z.string().min(1).max(100),direction:z.enum(["A","D"]),matched:count.positive(),unmatched:count,cancelled:count,
  late30:count,late60:count,late180:count,averageDelay:z.number().nonnegative().nullable(),
  sourceUrl:z.url().refine(v=>new URL(v).hostname==="www.caa.co.uk"),sourceRunDate:z.string().min(1),retrievedAt:z.number().int().positive()
}).strict().refine(r=>r.late180<=r.late60&&r.late60<=r.late30&&r.late30<=r.matched,"Delay counts must be nested and bounded by matched movements");
async function main(){
  const path=process.argv[2];if(!path)throw new Error("Supply a CAA aggregate JSON file.");
  const input=z.array(record).min(1).max(50000).parse(JSON.parse(await readFile(path,"utf8"))),db=await getDb();
  const updates=Object.fromEntries(Object.entries(getTableColumns(publishedPunctuality)).filter(([key])=>key!=="id").map(([key,column])=>[key,sql`excluded.${sql.identifier(column.name)}`]));
  for(let i=0;i<input.length;i+=50){
    await db.insert(publishedPunctuality).values(input.slice(i,i+50)).onConflictDoUpdate({target:publishedPunctuality.id,set:updates});
    if(i%500===0||i+50>=input.length)console.log(`Stored ${Math.min(i+50,input.length)} / ${input.length} published aggregates.`);
  }
  console.log("CAA import complete; individual flight and schedule tables are unchanged.");
  db.$client.close();
}
main().catch(e=>{console.error(e instanceof z.ZodError?e.issues:e.message);process.exitCode=1;});
