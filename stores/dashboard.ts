"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RegionId } from "@/lib/aviation/regions";
export type Layers={aircraft:boolean;aircraftLabels:boolean;airports:boolean;airportLabels:boolean;cities:boolean;radar:boolean;cloud:boolean;wind:boolean;temperature:boolean;weatherStations:boolean;tracks:boolean;coverage:boolean;route:boolean};
interface DashboardState {
  region:RegionId;mode:"live"|"demo";uiMode:"simple"|"advanced";selectedAirport:string|null;selectedAircraft:string|null;
  sidebarOpen:boolean;sidebarWidth:number;sidebarTab:"flights"|"airports"|"alerts";
  airportTab:string;theme:"dark"|"light";timezone:"UTC"|"local";
  layers:Layers;opacity:number;layersOpen:boolean;settingsOpen:boolean;searchOpen:boolean;
  measurement:boolean;recenter:number;flyTo:{longitude:number;latitude:number;zoom:number;id:number}|null;
  snapshotId:number|null;playing:boolean;speed:number;radarFrame:number;
  set:<K extends keyof Omit<DashboardState,"set"|"toggleLayer"|"selectAirport"|"selectAircraft">>(key:K,value:DashboardState[K])=>void;
  toggleLayer:(key:keyof Layers)=>void;selectAirport:(icao:string,longitude:number,latitude:number)=>void;
  selectAircraft:(id:string,longitude:number,latitude:number)=>void;
}
export const useDashboard=create<DashboardState>()(persist((set)=>({
  region:"central-europe",mode:"live",uiMode:"simple",selectedAirport:"EGLL",selectedAircraft:null,
  sidebarOpen:true,sidebarWidth:420,sidebarTab:"airports",airportTab:"overview",theme:"dark",timezone:"UTC",
  layers:{aircraft:true,aircraftLabels:false,airports:true,airportLabels:true,cities:true,radar:true,cloud:false,wind:false,temperature:false,weatherStations:false,tracks:true,coverage:true,route:false},
  opacity:0.65,layersOpen:false,settingsOpen:false,searchOpen:false,measurement:false,recenter:0,flyTo:null,
  snapshotId:null,playing:false,speed:1,radarFrame:-1,
  set:(key,value)=>set(s=>key==="uiMode"&&value==="simple"?{uiMode:"simple",layersOpen:false,measurement:false,playing:false,snapshotId:null,airportTab:"overview",sidebarTab:s.sidebarTab==="alerts"?"airports":s.sidebarTab}:{[key]:value}),toggleLayer:key=>set(s=>({layers:{...s.layers,[key]:!s.layers[key]}})),
  selectAirport:(icao,longitude,latitude)=>set({selectedAirport:icao,selectedAircraft:null,sidebarOpen:true,sidebarTab:"airports",airportTab:"overview",flyTo:{longitude,latitude,zoom:7,id:Date.now()}}),
  selectAircraft:(id,longitude,latitude)=>set({selectedAircraft:id,selectedAirport:null,sidebarOpen:true,sidebarTab:"flights",flyTo:{longitude,latitude,zoom:7,id:Date.now()}})
}),{name:"flightguard-preferences-v1",partialize:s=>({region:s.region,mode:s.mode,uiMode:s.uiMode,layers:s.layers,opacity:s.opacity,theme:s.theme,timezone:s.timezone,sidebarWidth:s.sidebarWidth})}));
