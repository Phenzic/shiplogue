// Single bridge to the shared Shiplogue core. The agent compiles the core from
// ../extension/src/core into dist/extension/src/core (see tsconfig rootDir).
// Keeping one bridge makes the dependency explicit and easy to move later.
export * from "../../extension/src/core";
