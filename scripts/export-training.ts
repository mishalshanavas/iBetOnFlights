import { writeFile } from "node:fs/promises";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { flights, flightPredictionEvidence } from "@/lib/db/schema";

async function main(){
  const path=process.argv[2]||"ml/datasets/europe-flights.json";
  if(!path.endsWith(".json"))throw new Error("Choose a .json output path.");
  const db=await getDb();
  const rows=await db.select().from(flights).innerJoin(flightPredictionEvidence,eq(flights.id,flightPredictionEvidence.flightId))
    .where(and(isNotNull(flights.actualArrival),isNotNull(flightPredictionEvidence.labelObservedAt),eq(flightPredictionEvidence.arrivalTimeBasis,"gate")))
    .orderBy(asc(flights.scheduledDeparture));
  if(!rows.length)throw new Error("No gate-arrival records with schedule/label observation evidence exist. Import genuine history with predictionEvidence first.");
  const records=rows.map(r=>({...r.flights,scheduleObservedAt:r.flight_prediction_evidence.scheduleObservedAt,
    labelObservedAt:r.flight_prediction_evidence.labelObservedAt,arrivalTimeBasis:r.flight_prediction_evidence.arrivalTimeBasis}));
  await writeFile(path,JSON.stringify(records,null,2),"utf8");
  console.log(`Exported ${records.length} provenance-labelled flight records. Validate before training.`);
  db.$client.close();
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
