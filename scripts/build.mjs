import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const webRoot = path.join(projectRoot, "awroadside-fire-work", "web");
const appRoot = path.join(projectRoot, "app");
const backendRoot = path.join(projectRoot, "backend");

await fs.rm(distRoot, { recursive: true, force: true });
await fs.mkdir(distRoot, { recursive: true });

await copyDir(webRoot, path.join(distRoot, "web"), {
  skip: (sourcePath) => path.basename(sourcePath).startsWith("legacy-")
});
await copyDir(appRoot, path.join(distRoot, "app"));
await copyDir(backendRoot, path.join(distRoot, "backend"));

const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
const deployPackage = {
  name: packageJson.name,
  version: packageJson.version,
  private: true,
  type: packageJson.type,
  scripts: {
    start: "node backend/server.mjs"
  },
  dependencies: packageJson.dependencies
};

await fs.writeFile(
  path.join(distRoot, "package.json"),
  `${JSON.stringify(deployPackage, null, 2)}\n`
);

await fs.writeFile(
  path.join(distRoot, "DEPLOY.md"),
  [
    "Deployment bundle prepared.",
    "Install with: npm install",
    "Run with: npm start"
  ].join("\n")
);

console.log(`Build prepared in ${distRoot}`);

async function copyDir(source, target, options = {}) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (typeof options.skip === "function" && options.skip(sourcePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath, options);
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}
