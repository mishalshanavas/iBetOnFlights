"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { AviationMap } from "./aviation-map";
import { Plane,ArrowUpRight,RefreshCw,Info,Radio } from "lucide-react";
import { OperationsSidebar } from "@/components/airport/operations-sidebar";
import { MapControls } from "./map-controls";
import { useAircraft } from "@/hooks/use-data";
import { useClock } from "@/hooks/use-clock";
import { useDashboard } from "@/stores/dashboard";
import { regions } from "@/lib/aviation/regions";
const AdvancedPanels=dynamic(()=>import("./advanced-panels").then(m=>m.AdvancedPanels),{ssr:false});
export function MapWorkspace(){
  const data=useAircraft(),s=useDashboard(useShallow(s=>({sidebarOpen:s.sidebarOpen,sidebarWidth:s.sidebarWidth,mode:s.mode,uiMode:s.uiMode,snapshotId:s.snapshotId,region:s.region,set:s.set})));
  const offset=s.sidebarOpen?s.sidebarWidth+34:76;
  return <div className={`map-workspace ${s.uiMode==="simple"?"map-simple":""}`}><AviationMap/><MapStatistics left={offset}/><OperationsSidebar/><MapControls/>{data.isError&&s.snapshotId===null&&<div className="feed-message" style={{left:offset}}><Info size={14}/><div><strong>Aircraft feed unavailable</strong><span>{data.error.message}</span></div><button onClick={()=>{s.set("mode","demo");s.set("selectedAircraft",null);}}>Explore demo</button><button aria-label="Retry aircraft feed" onClick={()=>void data.refetch()}><RefreshCw size={13}/></button></div>}{s.mode==="demo"&&s.snapshotId===null&&<div className="demo-message" style={{left:offset}}><Info size={12}/><span>DEMO TRAFFIC · Simulated aircraft. Weather and radar use real providers.</span><button onClick={()=>s.set("mode","live")}>Connect live<ArrowUpRight size={11}/></button></div>}{data.data?.storageWarning&&<div className="storage-warning">{data.data.storageWarning}</div>}<div className="map-area-label"><span className="tiny-dot"/><span>{regions[s.region].name.toUpperCase()}</span><small>REGIONAL COVERAGE</small></div>{s.uiMode==="advanced"?<AdvancedPanels/>:<div className="simple-map-footer"><span><Radio size={11}/>Live positions · airport weather · precipitation radar</span><span>WGS 84 · NOT FOR NAVIGATION</span></div>}</div>;
}
function MapStatistics({left}:{left:number}){const data=useAircraft(),now=useClock(),mode=useDashboard(s=>s.mode),snapshot=useDashboard(s=>s.snapshotId),advanced=useDashboard(s=>s.uiMode==="advanced");const counts=useMemo(()=>{const rows=data.data?.aircraft||[];return {total:rows.length,airborne:rows.filter(a=>!a.onGround).length};},[data.data]);const demo=mode==="demo"&&snapshot===null,age=now&&data.data?.source.observedAt?Math.max(0,now-data.data.source.observedAt):null;return <div className="map-statistics ticket-statistics" style={{left}}><div className="stat-item"><span><Plane size={12}/>OBSERVED AIRCRAFT</span><strong>{data.isPending?"—":counts.total}<small>{demo?"DEMO":"IN COVERAGE"}</small></strong></div>{advanced&&<><div className="stat-item"><span>AIRBORNE</span><strong>{data.data?counts.airborne:"—"}<small><span className="tiny-dot"/>ADS-B</small></strong></div><div className="stat-item"><span>ON GROUND</span><strong>{data.data?counts.total-counts.airborne:"—"}</strong></div></>}<div className="stat-item freshness"><span>SOURCE AGE</span><strong>{demo?"FIXTURE":age===null?"—":age<60?`${age}s`:`${Math.floor(age/60)}m`}<button aria-label="Refresh aircraft" onClick={()=>void data.refetch()}><RefreshCw size={12} className={data.isFetching?"spin":""}/></button></strong></div></div>;}
