import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({resolve:{alias:{"@":resolve(__dirname,".")}},test:{include:["tests/**/*.test.ts"],environment:"node",fileParallelism:false,isolate:false,maxWorkers:1,testTimeout:30000,hookTimeout:30000}});
