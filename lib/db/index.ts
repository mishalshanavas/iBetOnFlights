import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";
import { airports } from "@/data/airports";

let pending: Promise<ReturnType<typeof drizzle<typeof schema>>> | undefined;
export function getDb() {
  if (!pending) pending = initialize().catch(e=>{pending=undefined;throw e;});
  return pending;
}
async function initialize() {
  const url = process.env.DATABASE_URL || "file:./data/flightguard.db";
  if (process.env.VERCEL && !url.startsWith("libsql://") && !url.startsWith("https://")) {
    throw new Error("Hosted persistence requires a Turso DATABASE_URL; local SQLite is for development only.");
  }
  if (url.startsWith("file:") && !url.includes(":memory:")) await mkdir(dirname(resolve(url.slice(5))),{recursive:true});
  const client = createClient({url,authToken:process.env.DATABASE_AUTH_TOKEN});
  const columns=await client.execute("PRAGMA table_info(airport_weather)");
  if(columns.rows.some(c=>c.name==="forecastIssuedAt")&&!columns.rows.some(c=>c.name==="forecastRetrievedAt")){
    await client.executeMultiple(await readFile(resolve("drizzle/0001_weather_issuance.sql"),"utf8"));
  }
  const sql = await readFile(resolve("drizzle/0000_initial.sql"),"utf8");
  await client.executeMultiple(sql);
  const db = drizzle(client,{schema});
  await db.insert(schema.airportsTable).values(airports.map(({country,...airport})=>{void country;return airport;})).onConflictDoNothing();
  return db;
}
