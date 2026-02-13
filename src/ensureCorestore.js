import Corestore from "corestore";

function ensureCorestore(path) {
    return new Corestore(path);
}

export { ensureCorestore };