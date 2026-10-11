"use client";
import { Pause, Play, Plane } from "lucide-react";
import { motionSpeeds, useMapMotion } from "@/stores/map-motion";
import { useDashboard } from "@/stores/dashboard";
import { useShallow } from "zustand/react/shallow";
import { usePredictionRoutes } from "@/stores/prediction-routes";
export function MotionControls() {
  const motion = useMapMotion();
  const mode = useDashboard(state => state.mode);
  const hasRoutes = usePredictionRoutes(state => state.routes.features.length > 0);
  const sidebar=useDashboard(useShallow(state=>({open:state.sidebarOpen,width:state.sidebarWidth})));
  const description = hasRoutes ? "Airport connections / route preview" : mode === "demo" ? "Airport routes / simulated flights" : "Heading estimate / destination unavailable";
  return <div className="map-motion-controls" title={description} style={{left:sidebar.open?sidebar.width+34:76}}><span><Plane size={13} />Plane animation</span><button className="icon-button" aria-label={motion.playing ? "Pause plane animation" : "Play plane animation"} onClick={motion.toggle}>{motion.playing ? <Pause size={13} /> : <Play size={13} />}</button><label><span className="sr-only">Plane animation speed</span><select aria-label="Plane animation speed" value={motion.speed} onChange={event => motion.setSpeed(Number(event.target.value))}>{motionSpeeds.map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label><small>{description}</small></div>;
}
