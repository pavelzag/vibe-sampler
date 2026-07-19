import { contextBridge, ipcRenderer } from "electron";

console.info("[vibe-sampler:preload] Preload script starting");

contextBridge.exposeInMainWorld("vibeSampler", {
  appName: "Vibe Sampler",
  getCloudSampleOnboarding: () => ipcRenderer.invoke("cloud-samples:onboarding"),
  declineCloudSamples: () => ipcRenderer.invoke("cloud-samples:decline"),
  importCloudSamples: () => ipcRenderer.invoke("cloud-samples:import"),
  listUserBanks: () => ipcRenderer.invoke("sample-library:list"),
  createUserBank: (name: string) => ipcRenderer.invoke("sample-library:create-bank", name),
  loadUserBank: (bankId: string) => ipcRenderer.invoke("sample-library:load-bank", bankId),
  saveUserSample: (input: unknown) => ipcRenderer.invoke("sample-library:save-sample", input),
  setUserSamplePitch: (input: unknown) => ipcRenderer.invoke("sample-library:set-pitch", input),
  setUserSampleEdit: (input: unknown) => ipcRenderer.invoke("sample-library:set-edit", input)
});

console.info("[vibe-sampler:preload] Preload bridge exposed");
