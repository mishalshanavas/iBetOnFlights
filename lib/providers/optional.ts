import { unsupportedSource, type NotamProvider, type FlightScheduleProvider } from "./base";
export const notamProvider:NotamProvider={async fetch(){return {notices:[],source:unsupportedSource("Official NOTAM provider","Official NOTAM feed not connected. Consult an authorized briefing service.")};}};
export const scheduleProvider:FlightScheduleProvider={async search(){return {flights:[],source:unsupportedSource("Flight schedule provider","No authorized flight-status provider connected. Import verified flight records to explore schedules.")};}};
export const metarProvider={available:false,message:"Official METAR/TAF provider not connected; Open-Meteo fields are numerical forecasts."};
export const eurocontrolProvider={available:false,message:"EUROCONTROL operational data requires authorized access; no airspace restrictions are inferred."};
