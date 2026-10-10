"use client";
import { useEffect,useState } from "react";
import { CloudRain,ArrowUpRight } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useDashboard } from "@/stores/dashboard";
import { useRadar } from "@/hooks/use-data";
import { WeatherWidget } from "@/components/weather/airport-weather";
import { TimelinePlayback } from "./timeline-playback";
import { DeferredSection } from "@/components/ui/deferred-section";
import { formatTime } from "@/lib/utils";
export function AdvancedPanels(){const [wide,setWide]=useState(false);useEffect(()=>{const media=matchMedia("(min-width: 1101px)");const update=()=>setWide(media.matches);update();media.addEventListener("change",update);return()=>media.removeEventListener("change",update);},[]);return <>{wide&&<div className="floating-weather"><DeferredSection height={116}><WeatherWidget icao="EHAM" name="SCHIPHOL"/></DeferredSection><DeferredSection height={116}><WeatherWidget icao="EDDF" name="FRANKFURT"/></DeferredSection></div>}<RadarLegend/><TimelinePlayback/></>;}
function RadarLegend(){const s=useDashboard(useShallow(s=>({radar:s.layers.radar,radarFrame:s.radarFrame,set:s.set}))),radar=useRadar();if(!s.radar)return null;return <div className="weather-legend"><div><CloudRain size={12}/><strong>PRECIPITATION RADAR</strong><span>{radar.isError?"UNAVAILABLE":radar.data?`${formatTime(radar.data.frames[s.radarFrame<0?radar.data.frames.length-1:Math.min(s.radarFrame,radar.data.frames.length-1)]?.time)} UTC`:"LOADING"}</span></div><div className="legend-scale"><i/><i/><i/><i/><i/><i/><i/></div><div className="legend-labels"><span>Light</span><span>Moderate</span><span>Heavy</span></div>{radar.data&&<input aria-label="Radar frame" type="range" min={0} max={radar.data.frames.length-1} value={s.radarFrame<0?radar.data.frames.length-1:Math.min(s.radarFrame,radar.data.frames.length-1)} onChange={e=>s.set("radarFrame",Number(e.target.value))}/>}<a href="https://www.rainviewer.com" target="_blank" rel="noreferrer">Weather data by RainViewer<ArrowUpRight size={9}/></a></div>;}
