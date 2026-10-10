"use client";
import { useEffect,useRef,useState,type ReactNode } from "react";

// Keep a small window of rows in the DOM even for large surveillance feeds.
export function VirtualList<T>({items,rowHeight=68,renderRow,itemKey,resetKey}:{items:T[];rowHeight?:number;renderRow:(item:T)=>ReactNode;itemKey:(item:T)=>string;resetKey:string}){
  const ref=useRef<HTMLDivElement>(null),[scrollTop,setScrollTop]=useState(0),[height,setHeight]=useState(420);
  useEffect(()=>{const node=ref.current;if(!node)return;const observer=new ResizeObserver(()=>setHeight(node.clientHeight));observer.observe(node);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(ref.current)ref.current.scrollTop=0;setScrollTop(0);},[resetKey]);
  const start=Math.max(0,Math.floor(scrollTop/rowHeight)-4),end=Math.min(items.length,start+Math.ceil(height/rowHeight)+8);
  return <div ref={ref} className="virtual-list" onScroll={e=>setScrollTop(e.currentTarget.scrollTop)} role="list" aria-label="Observed aircraft"><div style={{height:items.length*rowHeight,position:"relative"}}>{items.slice(start,end).map((item,i)=><div role="listitem" key={itemKey(item)} style={{position:"absolute",top:(start+i)*rowHeight,height:rowHeight,width:"100%"}}>{renderRow(item)}</div>)}</div></div>;
}
