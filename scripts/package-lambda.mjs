import { build } from "esbuild";
import { copyFile,mkdir,access,rm } from "node:fs/promises";
const target="dist/lambda";
await mkdir(`${target}/drizzle`,{recursive:true});
await build({entryPoints:["aws/predictions.ts"],outfile:`${target}/index.js`,platform:"node",target:"node22",format:"cjs",bundle:true,tsconfig:"tsconfig.json",alias:{"@libsql/client":"@libsql/client/web"}});
for(const name of ["0000_initial.sql","0001_weather_issuance.sql","0001_prediction_evidence.sql","0002_published_punctuality.sql"])await copyFile(`drizzle/${name}`,`${target}/drizzle/${name}`);
const modelPath=process.env.CAA_MODEL_PATH||"ml/models/caa-model.json";
try{await access(modelPath);await mkdir(`${target}/ml/models`,{recursive:true});await copyFile(modelPath,`${target}/ml/models/caa-model.json`);}
catch(error){if(error.code!=="ENOENT")throw error;await rm(`${target}/ml/models/caa-model.json`,{force:true});console.warn("No released CAA model found; package will serve historical fallbacks only.");}
console.log(`Packaged prediction API in ${target}`);
