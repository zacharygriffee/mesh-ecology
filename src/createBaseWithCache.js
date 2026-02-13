import Autobase from "autobase";
import idEncoding from "hypercore-id-encoding";
import b4a from "b4a";

async function createBaseWithCache(corestore, bootstrapKey, handlers, baseCache) {
    const key = bootstrapKey || await Autobase.getLocalKey(corestore);
    const id = b4a.isBuffer(key) ? idEncoding.encode(key) : idEncoding.normalize(key);

    if (baseCache) {
        return baseCache.get(id, () => ({
            base: createBase(),
            cleanup: async (b) => {
                if (b?.close) await b.close();
            }
        }));
    } else {
        return createBase();
    }

    function createBase() {
        return new Autobase(corestore, key, handlers);
    }
}

export { createBaseWithCache }
