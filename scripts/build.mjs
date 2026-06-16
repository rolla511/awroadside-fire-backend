import { access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const androidRoot = path.join(projectRoot, "android");
const localPropertiesPath = path.join(androidRoot, "local.properties");
const gradleUserHome = path.join(androidRoot, ".gradle-home");
const releaseBundlePath = path.join(
  androidRoot,
  "app",
  "build",
  "outputs",
  "bundle",
  "release",
  "awroadside_fire_live-release.aab"
);

const sdkRoot = await resolveAndroidSdkRoot();
if (!sdkRoot) {
  fail(
    [
      "Android SDK path not found.",
      "Set `ANDROID_SDK_ROOT` or `ANDROID_HOME`, or install the SDK in `~/Library/Android/sdk`.",
      "This build script will not guess a non-existent SDK path."
    ].join("\n")
  );
}

await writeLocalProperties(sdkRoot);
await runGradleBuild();
await ensureReadableFile(releaseBundlePath);

console.log(`[build] AAB ready: ${releaseBundlePath}`);

async function resolveAndroidSdkRoot() {
  const candidates = [];

  const envSdkRoot = normalizePath(process.env.ANDROID_SDK_ROOT);
  const envAndroidHome = normalizePath(process.env.ANDROID_HOME);
  const localPropertiesSdk = await readSdkRootFromLocalProperties();

  if (envSdkRoot) candidates.push(envSdkRoot);
  if (envAndroidHome) candidates.push(envAndroidHome);
  if (localPropertiesSdk) candidates.push(localPropertiesSdk);

  candidates.push(
    path.join(os.homedir(), "Library", "Android", "sdk"),
    path.join("/Library", "Android", "sdk")
  );

  for (const candidate of candidates) {
    if (await isUsableAndroidSdk(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function readSdkRootFromLocalProperties() {
  try {
    const raw = await readFile(localPropertiesPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("sdk.dir=")) {
        continue;
      }
      return trimmed.slice("sdk.dir=".length).replace(/\\:/g, ":").replace(/\\\\/g, "\\");
    }
  } catch {
    return "";
  }
  return "";
}

async function isUsableAndroidSdk(candidate) {
  if (!candidate) {
    return false;
  }

  const requiredPaths = [
    path.join(candidate, "platforms"),
    path.join(candidate, "build-tools")
  ];

  for (const requiredPath of requiredPaths) {
    try {
      await access(requiredPath, fsConstants.R_OK);
    } catch {
      return false;
    }
  }

  return true;
}

async function writeLocalProperties(sdkDir) {
  const normalizedSdkDir = sdkDir.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  const content = `sdk.dir=${normalizedSdkDir}\n`;
  await writeFile(localPropertiesPath, content, "utf8");
}

async function runGradleBuild() {
  const javaHome = await resolveJavaHome();
  const gradleArgs = [":app:bundleRelease", "--stacktrace", "--no-daemon"];
  const env = {
    ...process.env,
    GRADLE_USER_HOME: gradleUserHome
  };

  if (javaHome && !env.JAVA_HOME) {
    env.JAVA_HOME = javaHome;
  }

  await spawnChecked("./gradlew", gradleArgs, {
    cwd: androidRoot,
    env
  });
}

async function resolveJavaHome() {
  if (normalizePath(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }

  const output = await captureCommand("/usr/libexec/java_home", []);
  return normalizePath(output.trim());
}

async function ensureReadableFile(targetPath) {
  try {
    await access(targetPath, fsConstants.R_OK);
  } catch (error) {
    fail(`Gradle completed without producing the expected AAB: ${targetPath}`);
  }
}

function normalizePath(value) {
  return typeof value === "string" ? value.trim() : "";
}

function spawnChecked(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function captureCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function fail(message) {
  console.error(`[build] ${message}`);
  process.exit(1);
}
