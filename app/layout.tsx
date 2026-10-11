import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/layout/app-shell";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import "./performance.css";
import "./predictions.css";
import "./map-motion.css";
export const metadata:Metadata={title:"FlightGuard · ATC Intelligence",description:"European aviation intelligence. Aircraft surveillance, airport weather, recorded history, and EU261 assessment."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><Providers><AppShell>{children}</AppShell></Providers></body></html>;}
