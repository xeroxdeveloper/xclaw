#!/usr/bin/env node

import module from "node:module";

if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {
    // Ignore errors
  }
}

if (!process.env.OPENCLAW_PROFILE) {
  process.env.OPENCLAW_PROFILE = "xclaw";
}

if (!process.env.OPENCLAW_XCLAW_MODE) {
  process.env.OPENCLAW_XCLAW_MODE = "1";
}

if (!process.env.OPENCLAW_ONLY_CHANNELS) {
  process.env.OPENCLAW_ONLY_CHANNELS = "telegram";
}

if (!process.env.OPENCLAW_ONLY_MODEL_PROVIDERS) {
  process.env.OPENCLAW_ONLY_MODEL_PROVIDERS = "openai,gemini";
}

const isModuleNotFoundError = (err) =>
  err && typeof err === "object" && "code" in err && err.code === "ERR_MODULE_NOT_FOUND";

const installProcessWarningFilter = async () => {
  for (const specifier of ["./dist/warning-filter.js", "./dist/warning-filter.mjs"]) {
    try {
      const mod = await import(specifier);
      if (typeof mod.installProcessWarningFilter === "function") {
        mod.installProcessWarningFilter();
        return;
      }
    } catch (err) {
      if (isModuleNotFoundError(err)) {
        continue;
      }
      throw err;
    }
  }
};

await installProcessWarningFilter();

const tryImport = async (specifier) => {
  try {
    await import(specifier);
    return true;
  } catch (err) {
    if (isModuleNotFoundError(err)) {
      return false;
    }
    throw err;
  }
};

if (await tryImport("./dist/entry.js")) {
  // OK
} else if (await tryImport("./dist/entry.mjs")) {
  // OK
} else {
  throw new Error("xclaw: missing dist/entry.(m)js (build output).");
}
