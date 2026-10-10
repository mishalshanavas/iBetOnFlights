import * as React from "react";
import { cva,type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const variants=cva("ui-button",{variants:{variant:{default:"button-default",outline:"button-outline",ghost:"button-ghost",accent:"button-accent"},size:{default:"",icon:"button-icon",sm:"button-small"}},defaultVariants:{variant:"default",size:"default"}});
export function Button({className,variant,size,...props}:React.ComponentProps<"button">&VariantProps<typeof variants>){return <button className={cn(variants({variant,size}),className)} {...props}/>;}
