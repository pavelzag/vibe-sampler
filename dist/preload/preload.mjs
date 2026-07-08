import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("vibeSampler", {
  appName: "Vibe Sampler"
});
