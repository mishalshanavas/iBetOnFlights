"use client";
import { useEffect,useState } from "react";
export function useClock(){const [time,setTime]=useState<number|null>(null);useEffect(()=>{const update=()=>setTime(Math.floor(Date.now()/1000));update();const timer=setInterval(update,10000);return()=>clearInterval(timer);},[]);return time;}
