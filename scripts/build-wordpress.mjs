import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const pluginSourceRoot = path.join(projectRoot, "wordpress", "awroadside-fire");
const outputRoot = path.join(projectRoot, "out", "wordpress", "awroadside-fire");
const webRoot = path.join(projectRoot, "web");

await fs.rm(outputRoot, { recursive: true, force: true });
await copyDir(pluginSourceRoot, outputRoot);
await fs.mkdir(path.join(outputRoot, "assets", "images"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "templates"), { recursive: true });

await fs.copyFile(path.join(webRoot, "styles.css"), path.join(outputRoot, "assets", "fire-styles.css"));
await fs.copyFile(path.join(webRoot, "app.js"), path.join(outputRoot, "assets", "fire-app.js"));
await copyDir(path.join(webRoot, "assets"), path.join(outputRoot, "assets", "images"));

const html = await fs.readFile(path.join(webRoot, "index.html"), "utf8");
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i);
if (!bodyMatch) {
  throw new Error("Unable to extract fire UI markup from web/index.html.");
}

const bodyContent = bodyMatch[1]
  .replace(/\s*<script src="app\.js"><\/script>\s*/i, "\n")
  .replaceAll('src="assets/roadside-home.png"', 'src="<?php echo esc_url(AWROADSIDE_FIRE_URL . \'assets/images/roadside-home.png\'); ?>"')
  .replaceAll('src="assets/roadside-subscriber.png"', 'src="<?php echo esc_url(AWROADSIDE_FIRE_URL . \'assets/images/roadside-subscriber.png\'); ?>"');

await fs.writeFile(path.join(outputRoot, "templates", "fire-ui.php"), `${bodyContent.trim()}\n`);

console.log(`WordPress plugin prepared in ${outputRoot}`);

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}
