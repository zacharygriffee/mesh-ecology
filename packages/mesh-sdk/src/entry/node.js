import { createMeshClientCore } from "../core/createMeshClientCore.js";
import { createNodePlatform } from "../platform/node/index.js";

function createMeshClient(config = {}) {
  return createMeshClientCore(createNodePlatform(), config);
}

export { createMeshClient };
