import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const pluginName = "firewp1home";
const pluginSourceRoot = path.join(projectRoot, "wordpress", pluginName);
const outputRoot = path.join(projectRoot, "out", "wordpress", pluginName);
const zipPath = path.join(projectRoot, "out", "wordpress", `${pluginName}.zip`);

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.rm(zipPath, { force: true });
await copyDir(pluginSourceRoot, outputRoot);

await execFileAsync("zip", ["-rq", zipPath, pluginName], {
  cwd: path.join(projectRoot, "out", "wordpress")
});

console.log(`WordPress plugin prepared in ${outputRoot}`);
console.log(`WordPress plugin zip prepared at ${zipPath}`);

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
      continue;
    }
    await fs.copyFile(sourcePath, targetPath);
  }
}
