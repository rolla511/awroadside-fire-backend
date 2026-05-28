if (!process.env.AW_RUNTIME_ENTRYPOINT) {
  process.env.AW_RUNTIME_ENTRYPOINT = "index.mjs";
}

await import("./server.mjs");
