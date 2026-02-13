import { material } from "./createSeedMaterial.js";
import Krypto from "hypercore-crypto";

function createHash(name, version = 1) {
    return Krypto.hash([material, ...Krypto.namespace(name, version)]);
}

function createKeyPair(name) {
    return Krypto.keyPair(createHash(name));
}

function commonTopics(name, count, version = 1) {
    return Krypto.namespace(createHash(name, version), count);
}

function defaultTopics(count, version = 1) {
    return commonTopics("default", count, version);
}

export { createKeyPair, createHash, commonTopics, defaultTopics };