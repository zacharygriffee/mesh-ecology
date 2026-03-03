import { createMeshClientCore } from "../core/createMeshClientCore.js";
import { createBarePlatform } from "../platform/bare/index.js";

function createMeshClient(config = {}) {
  return createMeshClientCore(createBarePlatform(), config);
}

export { createMeshClient };
