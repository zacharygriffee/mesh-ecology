import { createMeshClientCore } from "../core/createMeshClientCore.js";
import { createNodePlatform } from "../platform/node/index.js";
import { createHashPortBlake2b256 as createHashPortBlake2b256Core } from "../core/crypto/createHashPortBlake2b256.js";
import { hash32Blake2b256 } from "../platform/node/hash/blake2b256.js";
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
  return createMeshClientCore(createNodePlatform(), config);
}

export { createMeshClient, createHashPortBlake2b256 };
