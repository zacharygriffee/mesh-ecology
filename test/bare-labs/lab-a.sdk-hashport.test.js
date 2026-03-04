function assertOk(value, message) {
  if (!value) throw new Error(message);
}

async function importSdkEntry(specifier, fallbackPath) {
  try {
    return await import(specifier);
  } catch {
    return import(fallbackPath);
  }
}

const labName = "lab-a.sdk-hashport";

async function runLab() {
  const defaultMod = await importSdkEntry("@mesh/mesh-sdk", "../../packages/mesh-sdk/src/entry/bare.js");
  const bareMod = await importSdkEntry("@mesh/mesh-sdk/bare", "../../packages/mesh-sdk/src/entry/bare.js");

  assertOk(typeof defaultMod.createMeshClient === "function", "default entry must expose createMeshClient");
  assertOk(typeof bareMod.createMeshClient === "function", "bare entry must expose createMeshClient");

  assertOk(typeof defaultMod.createHashPortBlake2b256 === "function", "default entry must expose createHashPortBlake2b256");
  assertOk(typeof bareMod.createHashPortBlake2b256 === "function", "bare entry must expose createHashPortBlake2b256");

  const hashPort = defaultMod.createHashPortBlake2b256();
  const input = new Uint8Array(32);
  for (let i = 0; i < input.length; i++) input[i] = i;

  const digest = hashPort.hash32(input);
  assertOk(digest instanceof Uint8Array, "hash32 must return Uint8Array");
  assertOk(digest.byteLength === 32, "hash32 must return 32-byte digest");
  assertOk(hashPort.alg === "blake2b-256", "hash alg must be blake2b-256");
}

export { labName, runLab };
