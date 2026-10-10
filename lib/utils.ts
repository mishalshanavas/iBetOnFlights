import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const formatTime = (timestamp: number | string | null | undefined, zone = "UTC") => timestamp == null ? "—" : new Intl.DateTimeFormat("en-GB", {hour:"2-digit",minute:"2-digit",timeZone:zone}).format(new Date(typeof timestamp === "number" ? timestamp*1000 : timestamp));
export const weatherDescription = (code: number | null) => code === null ? "Unavailable" : code === 0 ? "Clear sky" : code <= 3 ? "Partly cloudy" : code <= 48 ? "Fog" : code <= 57 ? "Drizzle" : code <= 67 ? "Rain" : code <= 77 ? "Snow" : code <= 82 ? "Rain showers" : code <= 86 ? "Snow showers" : "Thunderstorm";
