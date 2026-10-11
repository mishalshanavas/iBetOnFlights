"use client";
import { Pause, Play, Plane } from "lucide-react";
import { motionSpeeds, useMapMotion } from "@/stores/map-motion";
import { useDashboard } from "@/stores/dashboard";
import { useShallow } from "zustand/react/shallow";
export function MotionControls() {
  const motion = useMapMotion();
  const sidebar=useDashboard(useShallow(state=>({open:state.sidebarOpen,width:state.sidebarWidth})));
  return <div className="map-motion-controls" style={{left:sidebar.open?sidebar.width+34:76}}><span><Plane size={13} />Plane animation</span><button className="icon-button" aria-label={motion.playing ? "Pause plane animation" : "Play plane animation"} onClick={motion.toggle}>{motion.playing ? <Pause size={13} /> : <Play size={13} />}</button><label><span className="sr-only">Plane animation speed</span><select aria-label="Plane animation speed" value={motion.speed} onChange={event => motion.setSpeed(Number(event.target.value))}>{motionSpeeds.map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label><small>Visual motion · not live position</small></div>;
}
