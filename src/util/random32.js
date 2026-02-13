import Krypto from "hypercore-crypto";

export function random32() {
    return Krypto.randomBytes(32);
}