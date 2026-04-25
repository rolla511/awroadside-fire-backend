const baseUrl = process.env.APP_URL || "http://127.0.0.1:3000";

const [health, status, files] = await Promise.all([
  fetch(`${baseUrl}/api/health`),
  fetch(`${baseUrl}/api/runtime/status`),
  fetch(`${baseUrl}/api/runtime/files`)
]);

if (!health.ok || !status.ok || !files.ok) {
  throw new Error(`Healthcheck failed: ${health.status}, ${status.status}, ${files.status}`);
}

const result = {
  health: await health.json(),
  runtimeStatus: await status.json(),
  runtimeFiles: await files.json()
};

console.log(JSON.stringify(result, null, 2));
