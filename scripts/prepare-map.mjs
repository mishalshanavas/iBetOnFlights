import { copyFile,mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const destination=resolve("public/vendor/maplibre");
await mkdir(destination,{recursive:true});
for(const file of ["maplibre-gl-worker.mjs","maplibre-gl-shared.mjs"]){
  await copyFile(resolve("node_modules/maplibre-gl/dist",file),resolve(destination,file));
}
console.log("MapLibre ESM worker assets prepared.");
