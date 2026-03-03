import { createMeshClientCore } from "../core/createMeshClientCore.js";
import { createBarePlatform } from "../platform/bare/index.js";
import { createHashPortBlake2b256 as createHashPortBlake2b256Core } from "../core/crypto/createHashPortBlake2b256.js";
import { hash32Blake2b256 } from "../platform/bare/hash/blake2b256.js";
export { asHashPort } from "../core/crypto/hashport.js";
export {
  assertHashPort,
  assertHash32Output,
  hash32Checked,
  createCheckedHashPort
} from "../core/crypto/assertHashPort.js";

function createHashPortBlake2b256() {
  return createHashPortBlake2b256Core(hash32Blake2b256);
}

function createMeshClient(config = {}) {
  return createMeshClientCore(createBarePlatform(), config);
}

export { createMeshClient, createHashPortBlake2b256 };
