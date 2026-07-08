import { contextBridge } from "electron";

console.info("[vibe-sampler:preload] Preload script starting");

contextBridge.exposeInMainWorld("vibeSampler", {
  appName: "Vibe Sampler"
});

console.info("[vibe-sampler:preload] Preload bridge exposed");
