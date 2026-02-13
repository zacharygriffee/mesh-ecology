import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";

async function findByKey(view, keyBuf) {
  const k32 = b4a.isBuffer(keyBuf) ? keyBuf : idEncoding.decode(keyBuf);
  for await (const entry of view.createReadStream()) {
    if (b4a.equals(entry.k32, k32)) return entry;
  }
  return null;
}

export { findByKey };
