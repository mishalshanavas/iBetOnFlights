import { build } from "esbuild";
import { copyFile,mkdir } from "node:fs/promises";
const target="dist/lambda";
await mkdir(`${target}/drizzle`,{recursive:true});
await build({entryPoints:["aws/predictions.ts"],outfile:`${target}/index.js`,platform:"node",target:"node22",format:"cjs",bundle:true,tsconfig:"tsconfig.json",alias:{"@libsql/client":"@libsql/client/web"}});
for(const name of ["0000_initial.sql","0001_weather_issuance.sql","0001_prediction_evidence.sql","0002_published_punctuality.sql"])await copyFile(`drizzle/${name}`,`${target}/drizzle/${name}`);
console.log(`Packaged empirical prediction API in ${target}`);
