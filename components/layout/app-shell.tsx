"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import { useEffect,useState,type ReactNode } from "react";
import { Shield,Plane,Map,Building2,ChartNoAxesCombined,Scale,Bell,Search,Settings2,ChevronDown,Radio } from "lucide-react";
import { useDashboard } from "@/stores/dashboard";
import { regions,type RegionId } from "@/lib/aviation/regions";
import { useAircraft,usePreferencesReady } from "@/hooks/use-data";
const GlobalSearch=dynamic(()=>import("./global-search").then(m=>m.GlobalSearch));
const SettingsDialog=dynamic(()=>import("./settings-dialog").then(m=>m.SettingsDialog));
import { Tooltip } from "@/components/ui/tooltip";
const navigation=[{href:"/",label:"Map",icon:Map},{href:"/flights",label:"Flights",icon:Plane},{href:"/airports",label:"Airports",icon:Building2},{href:"/predictions",label:"Predictions",icon:ChartNoAxesCombined},{href:"/compensation",label:"Compensation",icon:Scale},{href:"/analytics",label:"Analytics",icon:ChartNoAxesCombined},{href:"/alerts",label:"Alerts",icon:Bell}];
export function AppShell({children}:{children:ReactNode}){
  const preferencesReady=usePreferencesReady();
  const path=usePathname(),state=useDashboard(useShallow(s=>({region:s.region,theme:s.theme,searchOpen:s.searchOpen,settingsOpen:s.settingsOpen,set:s.set})));
  useEffect(()=>{document.documentElement.dataset.theme=state.theme;},[state.theme]);
  useEffect(()=>{const shortcut=(e:KeyboardEvent)=>{if(e.target instanceof HTMLElement && (e.target.closest("input,textarea,select,[contenteditable=true]")||e.target.closest("[role=dialog]")))return;if(e.key==="/"||e.key.toLowerCase()==="f"){e.preventDefault();useDashboard.getState().set("searchOpen",true);}if(e.key.toLowerCase()==="l")state.set("layersOpen",!useDashboard.getState().layersOpen);if(e.key==="Escape"){state.set("layersOpen",false);state.set("measurement",false);}if(e.code==="Space"&&path==="/"){e.preventDefault();state.set("playing",!useDashboard.getState().playing);}};window.addEventListener("keydown",shortcut);return()=>window.removeEventListener("keydown",shortcut);},[path,state.set]);
  return <div className="app-shell" inert={!preferencesReady}><header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><Shield size={25}/><Plane size={13}/></span><span>Flight<span className="brand-guard">Guard</span><small>ATC INTELLIGENCE</small></span></Link><div className="top-divider"/><label className="region-selector"><span className="region-dot"/><select aria-label="Coverage region" value={state.region} onChange={e=>{state.set("region",e.target.value as RegionId);state.set("snapshotId",null);state.set("recenter",Date.now());}}>{Object.entries(regions).map(([id,r])=><option value={id} key={id}>{r.name}</option>)}</select><ChevronDown size={12}/></label><nav className="main-nav" aria-label="Main navigation">{navigation.map(n=><Link key={n.href} href={n.href} prefetch={false} className={path===n.href?"active":""}><n.icon size={14}/><span>{n.label}</span></Link>)}</nav><div className="topbar-actions"><Tooltip label="Global search · /"><button className="top-search" onClick={()=>state.set("searchOpen",true)} aria-label="Global search"><Search size={15}/><span>Search</span><kbd>/</kbd></button></Tooltip><WorkspaceClock/><Tooltip label="Workspace settings"><button className="icon-button" aria-label="Settings" onClick={()=>state.set("settingsOpen",true)}><Settings2 size={17}/></button></Tooltip></div></header><SourceConnectionBar active={path==="/"||path==="/flights"}/><main className={path==="/"?"map-main":"page-main"}>{children}</main>{state.searchOpen&&<GlobalSearch/>}{state.settingsOpen&&<SettingsDialog/>}</div>;
}

function WorkspaceClock(){const state=useDashboard(useShallow(s=>({timezone:s.timezone,set:s.set})));const [clock,setClock]=useState("--:--:--");
  useEffect(()=>{const update=()=>setClock(new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:state.timezone==="UTC"?"UTC":Intl.DateTimeFormat().resolvedOptions().timeZone}).format(new Date()));update();const interval=setInterval(update,1000);return()=>clearInterval(interval);},[state.timezone]);
return <button className="clock" onClick={()=>state.set("timezone",state.timezone==="UTC"?"local":"UTC")} title="Switch UTC / device local time"><span>{clock}</span><small>{state.timezone==="UTC"?"UTC":"LOCAL"}</small></button>;}
function SourceConnectionBar({active}:{active:boolean}){const state=useDashboard(useShallow(s=>({mode:s.mode}))),aircraft=useAircraft(active);
  const status=state.mode==="demo"?"Demo traffic":!active&&!aircraft.data?"Feed idle":aircraft.isError?"Feed unavailable":aircraft.isPending?"Connecting":aircraft.data?.source.status==="historical"?"Recorded":aircraft.data?.source.observedAt && Date.now()/1000-aircraft.data.source.observedAt>300?"Stale feed":"Connected";

return <div className="connection-bar"><span className={`connection-dot ${state.mode==="demo"||aircraft.isError?"warning":""}`}/><span>{status}</span><span className="connection-separator">/</span><span>European surveillance network</span><div className="connection-right"><Radio size={10}/><span>{state.mode==="demo"?"SIMULATED POSITIONS":`POLL INTERVAL ${aircraft.data?.pollSeconds||120}s`}</span><span className="connection-separator">/</span><span>WORKSPACE 01</span></div></div>;}
