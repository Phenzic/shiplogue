// Shared Shiplogue core: pure data, capture, prompt, grounding and provider
// code used by both the VS Code extension and the agent. Nothing under this
// directory may import `vscode`.
export * from "./types";
export * from "./paths";
export * from "./ignore";
export * from "./format";
export * from "./formatProfile";
export * from "./grounding";
export * from "./standupDocument";
export * from "./standupQuality";
export * from "./budget";
export * from "./prompt";
export * from "./gather/activity";
export * from "./gather/git";
export * from "./gather/github";
export * from "./gather/cursor";
export * from "./gather/prompts";
export * from "./providers";
