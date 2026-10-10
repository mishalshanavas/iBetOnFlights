import { z } from "zod";
import { findAirport } from "@/data/airports";

export const itineraryInput=z.object({
  origin:z.string().regex(/^[A-Za-z]{4}$/).transform(v=>v.toUpperCase()).refine(v=>!!findAirport(v),"Unknown origin airport"),
  destination:z.string().regex(/^[A-Za-z]{4}$/).transform(v=>v.toUpperCase()).refine(v=>!!findAirport(v),"Unknown destination airport"),
  operatingAirline:z.string().trim().min(1).max(100).transform(v=>v.toUpperCase()),
  scheduledDeparture:z.number().int().positive(),scheduledArrival:z.number().int().positive()
}).strict().refine(v=>v.origin!==v.destination,"Origin and destination must differ")
  .refine(v=>v.scheduledArrival>v.scheduledDeparture&&v.scheduledArrival-v.scheduledDeparture<=86400,
    "Scheduled arrival must follow departure within 24 hours");
