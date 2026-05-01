import path from "path";
import { fileURLToPath } from "url";
import { createLocalWatchdog } from "../backend/local-watchdog.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(projectRoot, "app", "runtime");
const watchdog = createLocalWatchdog({
  projectRoot,
  runtimeRoot
});

const status = await watchdog.scanAndRecord();
console.log(JSON.stringify(status, null, 2));

if (!status.integrityOk) {
  process.exitCode = 1;
}
