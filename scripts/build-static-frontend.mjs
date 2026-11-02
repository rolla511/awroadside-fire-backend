import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const webRoot = path.join(projectRoot, "web");
const distRoot = path.join(projectRoot, "web-dist");

const files = [
  "awroadside-fire-index.html",
  "app.js",
  "frontend-index.js",
  "frontend-index.mjs",
  "awroadside-fire-style.css",
  "styles.css"
];
const excludedHtmlFiles = new Set(["index.html"]);

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

const rootEntries = await readdir(webRoot, { withFileTypes: true });
for (const entry of rootEntries) {
  if (entry.isFile() && entry.name.endsWith(".html") && !files.includes(entry.name) && !excludedHtmlFiles.has(entry.name)) {
    files.push(entry.name);
  }
}

for (const file of files) {
  await cp(path.join(webRoot, file), path.join(distRoot, file));
}

await cp(path.join(webRoot, "assets"), path.join(distRoot, "assets"), {
  recursive: true
});

console.log("Static frontend built in web-dist without temporary pre-signup pages.");
