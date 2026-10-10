"use client";
import { useEffect,useRef,useState,type ReactNode } from "react";

// Mount data consumers only as their section approaches its scroll viewport.
export function DeferredSection({children,height=160}:{children:ReactNode;height?:number}){
  const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
  useEffect(()=>{const node=ref.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:"80px"});observer.observe(node);return()=>observer.disconnect();},[]);
  return <div ref={ref} className="deferred-section" style={{minHeight:visible?undefined:height}}>{visible?children:<div className="section-placeholder" style={{height}} aria-label="Section loads when visible"><span/></div>}</div>;
}
