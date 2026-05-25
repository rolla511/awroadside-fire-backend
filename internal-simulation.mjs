import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function runSimulation() {
  console.log("[SIMULATION] Starting Internal Local Simulation...");
  console.log("[SIMULATION] Sandbox Lazy: false, Priority: screen");

  // 1. Prepare environment
  const envContent = await readFile("sandbox.env", "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    if (line && !line.startsWith("#")) {
      const [key, ...rest] = line.split("=");
      if (key) env[key.trim()] = rest.join("=").trim();
    }
  }

  // Ensure /var/data/awroadside-fire exists for file-runtime
  await mkdir("./var/data/awroadside-fire", { recursive: true });
  env.AW_RUNTIME_ROOT = "./var/data/awroadside-fire";

  console.log("[SIMULATION] Spawning Server...");
  const server = spawn("/usr/local/bin/node", ["backend/server.mjs"], {
    env: { ...process.env, ...env },
    stdio: "pipe"
  });

  let serverStarted = false;
  server.stdout.on("data", (data) => {
    const msg = data.toString();
    if (env.AW_PRIORITY_SCREEN === "true") {
       process.stdout.write(`[SERVER] ${msg}`);
    }
    if (msg.includes("Local runtime running at")) {
      serverStarted = true;
    }
  });

  server.stderr.on("data", (data) => {
    process.stderr.write(`[SERVER ERROR] ${data}`);
  });

  // Wait for server to start
  let attempts = 0;
  while (!serverStarted && attempts < 20) {
    await new Promise(resolve => setTimeout(resolve, 500));
    attempts++;
  }

  if (!serverStarted) {
    console.error("[SIMULATION] Server failed to start in time.");
    server.kill();
    process.exit(1);
  }

  console.log("\n[SIMULATION] --- TESTING POST /api/requests ---");
  const requestPayload = {
    serviceType: "TOWING",
    location: "123 Main St, Philadelphia, PA",
    vehicle: { make: "Toyota", model: "Camry", year: 2020 },
    fullName: "John Doe",
    phoneNumber: "555-0199"
  };

  try {
    const response = await fetch(`${BASE_URL}/api/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload)
    });
    
    const result = await response.json();
    console.log("[SIMULATION] POST Response:", response.status, result);
    
    if (response.status === 201) {
      console.log("[SIMULATION] SUCCESS: Request created with ID:", result.requestId);
      console.log("[SIMULATION] Verified: Geocode Source:", result.request?.locationGeocodeSource);
    } else {
      console.log("[SIMULATION] FAILED: Could not create request.");
    }

    console.log("\n[SIMULATION] --- TESTING GET /api/health ---");
    const healthResp = await fetch(`${BASE_URL}/api/health`);
    const health = await healthResp.json();
    console.log("[SIMULATION] Health Status:", health.status);

    console.log("\n[SIMULATION] --- TESTING GET /api/requests ---");
    const getRequestsResp = await fetch(`${BASE_URL}/api/requests`);
    const requests = await getRequestsResp.json();
    console.log("[SIMULATION] Request Count:", requests.requests?.length || 0);

    console.log("\n[SIMULATION] --- TESTING POST /api/payments/create-order ---");
    const paymentPayload = {
      ...requestPayload,
      requestId: result.requestId,
      amount: { currency_code: "USD", value: "25.00" }
    };
    const paymentResp = await fetch(`${BASE_URL}/api/payments/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paymentPayload)
    });
    const paymentResult = await paymentResp.json();
    console.log("[SIMULATION] Create Order Response:", paymentResp.status, paymentResult);

    if (paymentResp.status === 201) {
       console.log("[SIMULATION] SUCCESS: PayPal Order Created:", paymentResult.orderId);
    } else {
       console.log("[SIMULATION] FAILED: PayPal Order Creation failed (Expected if mock credentials fail real API check).");
    }

  } catch (error) {
    console.error("[SIMULATION] Request failed:", error.message);
  }

  console.log("\n[SIMULATION] Simulation Complete. Cleaning up...");
  server.kill();
}

runSimulation();
