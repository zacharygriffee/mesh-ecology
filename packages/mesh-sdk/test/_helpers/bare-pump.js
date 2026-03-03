function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pumpSteps({ steps = 1, stepDelayMs = 12, onStep = null } = {}) {
  for (let i = 0; i < steps; i++) {
    if (typeof onStep === "function") await onStep(i);
    if (stepDelayMs > 0) await sleepMs(stepDelayMs);
  }
}
export { pumpSteps };
