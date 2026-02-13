import LocalDrive from "localdrive";
import Krypto from "hypercore-crypto";
const drive = new LocalDrive(".");
let material = await drive.get("./material");

if (!material) {
    material = Krypto.randomBytes(32);
    await drive.put("./material", material);
}

export { material };
