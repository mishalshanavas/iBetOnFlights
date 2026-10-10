import type { Airport } from "@/lib/types";
export const airports: Airport[] = [
  {icao:"EGLL",iata:"LHR",name:"London Heathrow Airport",city:"London",country:"United Kingdom",countryCode:"GB",latitude:51.4706,longitude:-0.4619,elevationFt:83,timezone:"Europe/London"},
  {icao:"EHAM",iata:"AMS",name:"Amsterdam Schiphol Airport",city:"Amsterdam",country:"Netherlands",countryCode:"NL",latitude:52.3086,longitude:4.7639,elevationFt:-11,timezone:"Europe/Amsterdam"},
  {icao:"EDDF",iata:"FRA",name:"Frankfurt Airport",city:"Frankfurt",country:"Germany",countryCode:"DE",latitude:50.0379,longitude:8.5622,elevationFt:364,timezone:"Europe/Berlin"},
  {icao:"LFPG",iata:"CDG",name:"Paris Charles de Gaulle Airport",city:"Paris",country:"France",countryCode:"FR",latitude:49.0097,longitude:2.5479,elevationFt:392,timezone:"Europe/Paris"},
  {icao:"LEMD",iata:"MAD",name:"Adolfo Suárez Madrid–Barajas Airport",city:"Madrid",country:"Spain",countryCode:"ES",latitude:40.4722,longitude:-3.5608,elevationFt:1998,timezone:"Europe/Madrid"},
  {icao:"EDDM",iata:"MUC",name:"Munich Airport",city:"Munich",country:"Germany",countryCode:"DE",latitude:48.3538,longitude:11.7861,elevationFt:1487,timezone:"Europe/Berlin"},
  {icao:"LIRF",iata:"FCO",name:"Rome Fiumicino Airport",city:"Rome",country:"Italy",countryCode:"IT",latitude:41.8003,longitude:12.2389,elevationFt:13,timezone:"Europe/Rome"},
  {icao:"EIDW",iata:"DUB",name:"Dublin Airport",city:"Dublin",country:"Ireland",countryCode:"IE",latitude:53.4213,longitude:-6.2701,elevationFt:242,timezone:"Europe/Dublin"},
  {icao:"EBBR",iata:"BRU",name:"Brussels Airport",city:"Brussels",country:"Belgium",countryCode:"BE",latitude:50.9014,longitude:4.4844,elevationFt:184,timezone:"Europe/Brussels"},
  {icao:"LSZH",iata:"ZRH",name:"Zurich Airport",city:"Zurich",country:"Switzerland",countryCode:"CH",latitude:47.4647,longitude:8.5492,elevationFt:1416,timezone:"Europe/Zurich"},
  {icao:"EGKK",iata:"LGW",name:"London Gatwick Airport",city:"London",country:"United Kingdom",countryCode:"GB",latitude:51.1481,longitude:-0.1903,elevationFt:202,timezone:"Europe/London"},
  {icao:"EGCC",iata:"MAN",name:"Manchester Airport",city:"Manchester",country:"United Kingdom",countryCode:"GB",latitude:53.3537,longitude:-2.275,elevationFt:257,timezone:"Europe/London"},
  {icao:"EGPH",iata:"EDI",name:"Edinburgh Airport",city:"Edinburgh",country:"United Kingdom",countryCode:"GB",latitude:55.95,longitude:-3.3725,elevationFt:135,timezone:"Europe/London"},
  {icao:"LEBL",iata:"BCN",name:"Barcelona–El Prat Airport",city:"Barcelona",country:"Spain",countryCode:"ES",latitude:41.2974,longitude:2.0833,elevationFt:14,timezone:"Europe/Madrid"},
  {icao:"LIMC",iata:"MXP",name:"Milan Malpensa Airport",city:"Milan",country:"Italy",countryCode:"IT",latitude:45.6306,longitude:8.7281,elevationFt:768,timezone:"Europe/Rome"},
  {icao:"EKCH",iata:"CPH",name:"Copenhagen Airport",city:"Copenhagen",country:"Denmark",countryCode:"DK",latitude:55.6179,longitude:12.656,elevationFt:17,timezone:"Europe/Copenhagen"},
  {icao:"ENGM",iata:"OSL",name:"Oslo Gardermoen Airport",city:"Oslo",country:"Norway",countryCode:"NO",latitude:60.1939,longitude:11.1004,elevationFt:681,timezone:"Europe/Oslo"},
  {icao:"ESSA",iata:"ARN",name:"Stockholm Arlanda Airport",city:"Stockholm",country:"Sweden",countryCode:"SE",latitude:59.6519,longitude:17.9186,elevationFt:137,timezone:"Europe/Stockholm"},
  {icao:"LOWW",iata:"VIE",name:"Vienna International Airport",city:"Vienna",country:"Austria",countryCode:"AT",latitude:48.1103,longitude:16.5697,elevationFt:600,timezone:"Europe/Vienna"},
  {icao:"LPPT",iata:"LIS",name:"Humberto Delgado Airport",city:"Lisbon",country:"Portugal",countryCode:"PT",latitude:38.7742,longitude:-9.1342,elevationFt:374,timezone:"Europe/Lisbon"},
  {icao:"EPWA",iata:"WAW",name:"Warsaw Chopin Airport",city:"Warsaw",country:"Poland",countryCode:"PL",latitude:52.1657,longitude:20.9671,elevationFt:362,timezone:"Europe/Warsaw"},
  {icao:"LGAV",iata:"ATH",name:"Athens International Airport",city:"Athens",country:"Greece",countryCode:"GR",latitude:37.9364,longitude:23.9445,elevationFt:308,timezone:"Europe/Athens"},
  {icao:"KJFK",iata:"JFK",name:"John F. Kennedy International Airport",city:"New York",country:"United States",countryCode:"US",latitude:40.6413,longitude:-73.7781,elevationFt:13,timezone:"America/New_York"},
  {icao:"OMDB",iata:"DXB",name:"Dubai International Airport",city:"Dubai",country:"United Arab Emirates",countryCode:"AE",latitude:25.2532,longitude:55.3657,elevationFt:62,timezone:"Asia/Dubai"}
];
export const europeanAirports = airports.filter(a => !["US", "AE"].includes(a.countryCode));
export const findAirport = (id: string) => airports.find(a => a.icao === id.toUpperCase() || a.iata === id.toUpperCase());
