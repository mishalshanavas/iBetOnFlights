import { defineConfig,devices } from "@playwright/test";
const baseURL=process.env.PLAYWRIGHT_BASE_URL||"http://localhost:3000";
export default defineConfig({testDir:"./tests/ui",timeout:45000,fullyParallel:false,use:{baseURL,trace:"retain-on-failure",...devices["Desktop Chrome"],launchOptions:process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:undefined},webServer:{command:"npm run dev",url:baseURL,reuseExistingServer:true,timeout:120000}});
