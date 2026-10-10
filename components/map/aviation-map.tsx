"use client";
import { useEffect,useRef,useState } from "react";
import maplibregl,{type Map as MapType,type GeoJSONSource} from "maplibre-gl";
import type { FeatureCollection,Feature,Point } from "geojson";
import { useQueries } from "@tanstack/react-query";
import { useDashboard } from "@/stores/dashboard";
import { useAircraft,useRadar,useTrack,api } from "@/hooks/use-data";
import { europeanAirports } from "@/data/airports";
import { regions } from "@/lib/aviation/regions";
import { distanceKm,feet,knots } from "@/lib/aviation/geo";
import type { WeatherResponse } from "@/lib/types";
import { formatTime } from "@/lib/utils";
const empty:FeatureCollection={type:"FeatureCollection",features:[]};
const setData=(map:MapType,id:string,data:FeatureCollection)=>{(map.getSource(id) as GeoJSONSource|undefined)?.setData(data);};
export function AviationMap(){
  const container=useRef<HTMLDivElement>(null),mapRef=useRef<MapType|null>(null),s=useDashboard(),aircraft=useAircraft(),radar=useRadar(),track=useTrack(s.selectedAircraft);
  const [ready,setReady]=useState(0),[mapError,setMapError]=useState(""),[measure,setMeasure]=useState<{km:number;count:number}|null>(null);
  const weatherNeeded=s.layers.cloud||s.layers.wind||s.layers.temperature||s.layers.weatherStations;
  const forecasts=useQueries({queries:europeanAirports.map(a=>({queryKey:["weather",a.icao],queryFn:()=>api<WeatherResponse>(`/api/airports/${a.icao}/weather`),enabled:weatherNeeded,staleTime:900000,retry:false}))});
  const positions=aircraft.data?.aircraft||[];
  useEffect(()=>{
    if(!container.current)return;
    const state=useDashboard.getState();
    const map=new maplibregl.Map({container:container.current,style:process.env.NEXT_PUBLIC_MAP_STYLE_URL||"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",center:[4.7,50.7],zoom:4.9,maxZoom:18,minZoom:3,attributionControl:{compact:true},renderWorldCopies:false});
    mapRef.current=map;
    const popup=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:15,className:"aircraft-popup"});
    map.on("load",()=>{setMapError("");setReady(v=>v+1);});
    map.on("error",e=>{if(!map.isStyleLoaded()&&e.error?.message)setMapError("Map tiles could not load. Check your connection or map style URL.");});
    map.on("click",e=>{
      if(useDashboard.getState().measurement)return;
      const layers=["aircraft-symbols","airport-markers","weather-points"].filter(id=>map.getLayer(id));
      const feature=layers.length?map.queryRenderedFeatures(e.point,{layers})[0]:undefined;if(!feature)return;
      const p=feature.properties;if(feature.geometry.type!=="Point")return;const [longitude,latitude]=feature.geometry.coordinates;
      if(feature.layer.id==="aircraft-symbols")useDashboard.getState().selectAircraft(p.icao24,longitude,latitude);
      else useDashboard.getState().selectAirport(p.icao,longitude,latitude);
    });
    map.on("mousemove",e=>{
      if(!map.getLayer("aircraft-symbols"))return;const f=map.queryRenderedFeatures(e.point,{layers:["aircraft-symbols"]})[0];
      map.getCanvas().style.cursor=useDashboard.getState().measurement?"crosshair":f?"pointer":"";
      if(!f||f.geometry.type!=="Point"){popup.remove();return;}
      const a=(aircraftRef.current||[]).find(a=>a.icao24===f.properties.icao24);if(!a)return;
      const element=document.createElement("div");element.className="aircraft-tooltip";
      const heading=document.createElement("strong");heading.textContent=a.callsign||"Callsign unavailable";element.append(heading);
      const identity=document.createElement("small");identity.textContent=`ICAO24 ${a.icao24.toUpperCase()}`;element.append(identity);
      for(const [key,value] of [["ALTITUDE",`${feet(a.baroAltitude)} ft`],["GROUND SPEED",`${knots(a.velocity)} kt`],["HEADING",a.heading===null?"—":`${Math.round(a.heading)}°`],["VERTICAL RATE",a.verticalRate===null?"—":`${Math.round(a.verticalRate*196.8504)} ft/min`],["OBSERVED",`${formatTime(a.timePosition??a.lastContact)} UTC`]]){const row=document.createElement("div"),label=document.createElement("span"),data=document.createElement("b");label.textContent=key;data.textContent=value;row.append(label,data);element.append(row);}
      popup.setLngLat([a.longitude,a.latitude]).setDOMContent(element).addTo(map);
    });
    if(state.theme==="light")map.setStyle("https://basemaps.cartocdn.com/gl/positron-gl-style/style.json");
    return()=>{popup.remove();map.remove();mapRef.current=null;};
  },[]);
  const aircraftRef=useRef(positions);aircraftRef.current=positions;
  useEffect(()=>{
    const map=mapRef.current;if(!map||!ready)return;
    if(map.getSource("aircraft"))return;
    const canvas=document.createElement("canvas");canvas.width=64;canvas.height=64;const ctx=canvas.getContext("2d")!;
    ctx.fillStyle="#fff";ctx.beginPath();for(const [i,[x,y]] of [[32,3],[36,9],[36,26],[58,40],[58,45],[36,37],[35,51],[44,57],[44,61],[32,57],[20,61],[20,57],[29,51],[28,37],[6,45],[6,40],[28,26],[28,9]].entries()){if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.closePath();ctx.fill();
    map.addImage("aircraft-icon",ctx.getImageData(0,0,64,64),{sdf:true});
    map.addSource("coverage",{type:"geojson",data:empty});
    map.addLayer({id:"coverage-fill",type:"fill",source:"coverage",paint:{"fill-color":"#7896ed","fill-opacity":0.018}});
    map.addLayer({id:"coverage-border",type:"line",source:"coverage",paint:{"line-color":"#7896ed","line-opacity":0.4,"line-width":1,"line-dasharray":[6,5]}});
    map.addSource("airports",{type:"geojson",data:{type:"FeatureCollection",features:europeanAirports.map(a=>({type:"Feature",geometry:{type:"Point",coordinates:[a.longitude,a.latitude]},properties:{icao:a.icao,iata:a.iata,name:a.name}}))}});
    map.addLayer({id:"airport-markers",type:"circle",source:"airports",paint:{"circle-radius":["case",["==",["get","icao"],s.selectedAirport||""],5.5,3.5],"circle-color":"#bbc2ce","circle-stroke-color":"#262e3b","circle-stroke-width":2}});
    map.addLayer({id:"airport-labels",type:"symbol",source:"airports",layout:{"text-field":["get","icao"],"text-font":["Open Sans Semibold"],"text-size":10,"text-offset":[0,1.5],"text-anchor":"top"},paint:{"text-color":"#b6bbc5","text-halo-color":"#111519","text-halo-width":2}});
    map.addSource("weather",{type:"geojson",data:empty});
    map.addLayer({id:"cloud-forecast",type:"circle",source:"weather",paint:{"circle-radius":48,"circle-color":"#c0cad9","circle-opacity":["*",["/",["get","cloud"],100],0.18],"circle-blur":0.8}});
    map.addLayer({id:"weather-points",type:"circle",source:"weather",paint:{"circle-radius":7,"circle-color":["interpolate",["linear"],["get","temperature"],-10,"#5e82d5",10,"#5dbca5",25,"#e9b44c",35,"#f36a6a"],"circle-stroke-width":1,"circle-stroke-color":"#e8ebef"}});
    map.addLayer({id:"temperature-labels",type:"symbol",source:"weather",layout:{"text-field":["concat",["to-string",["round",["get","temperature"]]],"°"],"text-size":11,"text-offset":[0,-2],"text-font":["Open Sans Semibold"]},paint:{"text-color":"#e8ebef","text-halo-color":"#161a20","text-halo-width":2}});
    map.addLayer({id:"wind-labels",type:"symbol",source:"weather",layout:{"text-field":["concat","↑ ",["to-string",["round",["get","wind"]]]," m/s"],"text-size":11,"text-offset":[0,2],"text-font":["Open Sans Semibold"]},paint:{"text-color":"#99c8d5","text-halo-color":"#161a20","text-halo-width":2}});
    map.addSource("track",{type:"geojson",data:empty});map.addLayer({id:"aircraft-track",type:"line",source:"track",paint:{"line-color":"#77d7e5","line-width":2,"line-opacity":0.75}});
    map.addSource("aircraft",{type:"geojson",data:empty});map.addLayer({id:"aircraft-symbols",type:"symbol",source:"aircraft",layout:{"icon-image":"aircraft-icon","icon-size":["interpolate",["linear"],["zoom"],3,0.22,6,0.32,10,0.43],"icon-rotate":["coalesce",["get","heading"],0],"icon-rotation-alignment":"map","icon-allow-overlap":true,"icon-ignore-placement":true},paint:{"icon-color":["case",["==",["get","icao24"],s.selectedAircraft||""],"#77d7e5",["get","onGround"],"#717985","#d4dae2"],"icon-opacity":0.9,"icon-halo-color":"#77d7e5","icon-halo-width":0}});
    map.addLayer({id:"aircraft-labels",type:"symbol",source:"aircraft",minzoom:6,layout:{"text-field":["coalesce",["get","callsign"],""],"text-size":9,"text-font":["Open Sans Regular"],"text-offset":[0,2]},paint:{"text-color":"#bdc5d0","text-halo-color":"#11151a","text-halo-width":2}});
    map.addSource("measurement",{type:"geojson",data:empty});map.addLayer({id:"measurement-line",type:"line",source:"measurement",paint:{"line-color":"#e9b44c","line-width":2,"line-dasharray":[3,2]}});
    setReady(v=>v+1);
  },[ready]);
  useEffect(()=>{const map=mapRef.current;if(!map||!ready)return;setData(map,"aircraft",{type:"FeatureCollection",features:positions.map(a=>({type:"Feature",geometry:{type:"Point",coordinates:[a.longitude,a.latitude]},properties:{icao24:a.icao24,callsign:a.callsign,heading:a.heading,onGround:a.onGround}}))});if(map.getLayer("aircraft-symbols"))map.setPaintProperty("aircraft-symbols","icon-color",["case",["==",["get","icao24"],s.selectedAircraft||""],"#77d7e5",["get","onGround"],"#717985","#d4dae2"]);},[aircraft.data,ready,s.selectedAircraft]);
  useEffect(()=>{const map=mapRef.current;if(!map||!ready)return;const [w,south,e,n]=regions[s.region].bounds;setData(map,"coverage",{type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Polygon",coordinates:[[[w,south],[e,south],[e,n],[w,n],[w,south]]]},properties:{}}]});},[s.region,ready]);
  useEffect(()=>{const map=mapRef.current;if(!map||!ready)return;const ids:Record<string,boolean>={"aircraft-symbols":s.layers.aircraft,"aircraft-labels":s.layers.aircraft&&s.layers.aircraftLabels,"airport-markers":s.layers.airports,"airport-labels":s.layers.airports&&s.layers.airportLabels,"cloud-forecast":s.layers.cloud,"weather-points":s.layers.weatherStations||s.layers.temperature,"temperature-labels":s.layers.temperature,"wind-labels":s.layers.wind,"aircraft-track":s.layers.tracks,"coverage-fill":s.layers.coverage,"coverage-border":s.layers.coverage};for(const [id,on]of Object.entries(ids))if(map.getLayer(id))map.setLayoutProperty(id,"visibility",on?"visible":"none");for(const layer of map.getStyle().layers||[])if(/place_city|place_town|city-label|town-label/.test(layer.id))map.setLayoutProperty(layer.id,"visibility",s.layers.cities?"visible":"none");},[s.layers,ready]);
  useEffect(()=>{const map=mapRef.current;if(!map||!ready||!radar.data?.frames.length)return;const frame=radar.data.frames[s.radarFrame<0?radar.data.frames.length-1:Math.min(s.radarFrame,radar.data.frames.length-1)];const tiles=[`${radar.data.host}${frame.path}/256/{z}/{x}/{y}/2/1_0.png`];if(map.getLayer("radar"))map.removeLayer("radar");if(map.getSource("radar"))map.removeSource("radar");map.addSource("radar",{type:"raster",tiles,tileSize:256,maxzoom:7,attribution:'Weather data by <a href="https://www.rainviewer.com">RainViewer</a>'});map.addLayer({id:"radar",type:"raster",source:"radar",paint:{"raster-opacity":s.opacity,"raster-fade-duration":0},layout:{visibility:s.layers.radar?"visible":"none"}},map.getLayer("coverage-fill")?"coverage-fill":undefined);},[radar.data,ready,s.radarFrame]);
  useEffect(()=>{const map=mapRef.current;if(map?.getLayer("radar")){map.setLayoutProperty("radar","visibility",s.layers.radar?"visible":"none");map.setPaintProperty("radar","raster-opacity",s.opacity);}},[s.layers.radar,s.opacity]);
  useEffect(()=>{const map=mapRef.current;if(!map||!ready)return;const data=track.data?.track||[];setData(map,"track",{type:"FeatureCollection",features:data.length>1?[{type:"Feature",geometry:{type:"LineString",coordinates:data.map(a=>[a.longitude,a.latitude])},properties:{}}]:[]});},[track.data,ready]);
  const forecastSignature=forecasts.map(q=>q.dataUpdatedAt).join(",");
  useEffect(()=>{const map=mapRef.current;if(!map||!ready)return;const features:Feature<Point>[]=[];forecasts.forEach((q,i)=>{const p=q.data?.current;if(!p)return;features.push({type:"Feature",geometry:{type:"Point",coordinates:[europeanAirports[i].longitude,europeanAirports[i].latitude]},properties:{icao:europeanAirports[i].icao,temperature:p.temperature??0,cloud:p.cloudCover??0,wind:p.windSpeed??0}});});setData(map,"weather",{type:"FeatureCollection",features});},[forecastSignature,ready]);
  useEffect(()=>{const map=mapRef.current;if(!map||!s.flyTo)return;const f=s.flyTo;map.flyTo({center:[f.longitude,f.latitude],zoom:f.zoom,padding:{left:window.innerWidth>800&&s.sidebarOpen?s.sidebarWidth:0,right:80,top:80,bottom:100},duration:matchMedia("(prefers-reduced-motion: reduce)").matches?0:900});},[s.flyTo]);
  useEffect(()=>{const map=mapRef.current;if(!map||!s.recenter)return;const r=regions[s.region];map.flyTo({center:r.center,zoom:r.zoom,bearing:0,padding:{left:0,right:0,top:0,bottom:0}});},[s.recenter]);
  useEffect(()=>{const map=mapRef.current;if(!map)return;const desired=s.theme==="dark"?(process.env.NEXT_PUBLIC_MAP_STYLE_URL||"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"):"https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";if(ready){map.setStyle(desired);map.once("style.load",()=>setReady(v=>v+1));}},[s.theme]);
  useEffect(()=>{const map=mapRef.current;if(!map||!ready)return;const points:[number,number][]=[];setData(map,"measurement",empty);setMeasure(null);if(!s.measurement)return;const handler=(e:maplibregl.MapMouseEvent)=>{points.push([e.lngLat.lng,e.lngLat.lat]);if(points.length>1)setData(map,"measurement",{type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:points}}]});let km=0;for(let i=1;i<points.length;i++)km+=distanceKm(points[i-1][1],points[i-1][0],points[i][1],points[i][0]);setMeasure({km,count:points.length});};map.on("click",handler);return()=>{map.off("click",handler);map.getCanvas().style.cursor="";};},[s.measurement,ready]);
  useEffect(()=>{const listener=(e:Event)=>{const map=mapRef.current;if(!map)return;switch((e as CustomEvent).detail){case"zoom-in":map.zoomIn();break;case"zoom-out":map.zoomOut();break;case"bearing":map.resetNorth();break;}};window.addEventListener("flightguard-map",listener);return()=>window.removeEventListener("flightguard-map",listener);},[]);
  return <><div ref={container} className="aviation-map" data-testid="aviation-map"/>{mapError&&<div className="map-error">{mapError}<button onClick={()=>{setMapError("");mapRef.current?.setStyle(process.env.NEXT_PUBLIC_MAP_STYLE_URL||"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json");}}>Retry tiles</button></div>}{s.measurement&&<div className="measurement-info"><strong>MEASUREMENT</strong><span>{measure?`${measure.km.toFixed(1)} km · ${(measure.km/1.852).toFixed(1)} NM`:"Click map points to measure distance"}</span><button onClick={()=>s.set("measurement",false)}>Done</button></div>}</>;
}
