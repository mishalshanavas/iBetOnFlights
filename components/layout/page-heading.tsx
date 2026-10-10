import { Radio } from "lucide-react";
import type { ReactNode } from "react";
export function PageHeading({eyebrow,title,description,actions}:{eyebrow:string;title:string;description:string;actions?:ReactNode}){return <div className="page-heading"><div><div className="page-eyebrow"><Radio size={11}/>{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{actions&&<div className="page-heading-actions">{actions}</div>}</div>;}
