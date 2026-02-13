import {ensureDiscoverySurface} from "./discovery.js";
import {ensureConcernSurface, publishJobRatification} from "./concern.js";
import idEncoding from "hypercore-id-encoding";
import {updateWithTimeout} from "./util/updateWithTimeout.js";

function ensureRatifier(corestore, swarm) {
    const discoveries = [];
    return {
        async addDiscovery(discoveryKey) {
            console.log("[ratifier] addDiscovery called", discoveryKey);
            const keyBuf = idEncoding.decode(discoveryKey);
            const disc = await ensureDiscoverySurface(corestore, {key: keyBuf});
            discoveries.unshift(disc);
            await updateWithTimeout(disc);
            console.log("[ratifier] discovery added; total", discoveries.length);
        },
        removeDiscovery(discoveryViewKey) {
            const idx = discoveries.indexOf(discoveryViewKey);
            if (idx >= 0) {
                discoveries.splice(idx, 1);
            }
            console.log("[ratifier] discovery removed; total", discoveries.length);
        },
        async nextDiscovery(projector) {
            console.log("[ratifier] nextDiscovery start; discoveries", discoveries.length);
            if (!projector) {
                projector = async (handle) => {
                    console.log("Unimplemented ratifier projector", handle.key);
                    await sleep(1000);
                }
            }
            try {
                if (!discoveries.length) throw new Error("no discoveries");
                const base = discoveries.pop();
                discoveries.unshift(base);
                const view = base.view;
                await updateWithTimeout(base);
                console.log("discovery view", view.length);
                for await (const concernRecord of view.createReadStream()) {
                    try {
                        await processConcern(corestore, concernRecord, swarm, projector);
                    } catch (e) {
                        console.error("Concern processing failed; skipping", e);
                    }
                }
                console.log("[ratifier] nextDiscovery done");
            } catch (e) {
                console.error("Ratifier Error:", e);
            }
        }
    }
}

async function processConcern(corestore, concernRecord, swarm, projector) {
    const {key, value: concernMeta} = concernRecord;
    console.log("[ratifier] processConcern start", key, concernMeta);
    const concernBase = await ensureConcernSurface(corestore.namespace(`rat-${key}`), swarm, { key });
    await updateWithTimeout(concernBase);
    const ratifierKey = idEncoding.encode(concernBase.local.key);
    console.log("[ratifier] ratifierKey", ratifierKey);

    const pubBee = concernBase.view.sub("pub");
    console.log("[ratifier] pubBee length", pubBee.core.length);
    if (pubBee.core.length > 0) {
        try {
            for await (const workRecord of pubBee.createReadStream()) {
                const { value: { oK: organismKey, ref: { k: jobKey, a: attemptToken } }} = workRecord;
                console.log("[ratifier] work record", { jobKey, attemptToken, organismKey });

                const ratRecordView = concernBase.view
                    .sub("rat")
                    .sub(jobKey)
                    .sub(ratifierKey)
                    .sub(organismKey);

                const already = await ratRecordView.get(attemptToken);
                if (already) {
                    console.log("[ratifier] already ratified; skipping", { jobKey, attemptToken, organismKey });
                    continue;
                }
                await processRatification(
                    projector,
                    workRecord,
                    concernMeta,
                    organismKey,
                    ratifierKey,
                    async packet => {
                        const [
                            jobKey,
                            orgKey,
                            attemptToken,
                            determination,
                            tier,
                            cap,
                            ref,
                            note
                        ] = packet;
                        console.log("[ratifier] Publishing ratification", { jobKey, orgKey, attemptToken, determination, tier, cap, ref, note });
                        await publishJobRatification(
                            concernBase,
                            jobKey,
                            orgKey,
                            attemptToken,
                            determination,
                            tier,
                            cap,
                            ref,
                            note
                        );
                        console.log("[ratifier] Published ratification", { jobKey, orgKey, attemptToken, determination, tier, cap, ref, note });
                    }
                )
            }
        } catch (e) {
            console.error("Concern Work Error:", e);
        }
    } else {
        console.log("[ratifier] No work to ratify", key);
    }

    await updateWithTimeout(concernBase);
    // await sleep(6000);
    // await concernBase.close();
    console.log("[ratifier] processConcern end", key);
}

async function ensureConcernBase(corestore, swarm, concernCache, key) {
    return concernCache.get(key, async () => {
        console.log("[ratifier] loading concernBase", key);
        const concernBase = await ensureConcernSurface(corestore.namespace(key), {key: idEncoding.decode(key)});

        if (swarm.connections.size > 0) {
            for (const conn of swarm.connections) concernBase.replicate(conn);
            await updateWithTimeout(concernBase);
        }

        const handler = conn => concernBase.replicate(conn);
        if (typeof swarm.on === "function") swarm.on("connection", handler);

        const cleanup = async () => {
            try {
                if (typeof swarm.off === "function") {
                    swarm.off("connection", handler);
                } else if (typeof swarm.removeListener === "function") {
                    swarm.removeListener("connection", handler);
                }
            } catch (e) {
                console.error("Failed to remove connection handler", e);
            }
            try {
                await concernBase.close();
            } catch (e) {
                console.error("Failed to close concernBase", e);
            }
        };

        return { base: concernBase, cleanup };
    });
}

async function processRatification(
    projector,
    workRecord,
    concernMeta,
    organismKey,
    ratifierKey,
    publish
) {
    const {
        value: work
    } = workRecord;

    const {
        cap,
        ref: {
            a: attemptToken,
            t: type,
            k: jobKey,
            h: hash,
            p: path
        },
        meta
    } = work;

    const packet = [
        jobKey,
        organismKey,
        attemptToken,
        undefined,      // determination
        undefined,      // tier
        cap,
        work.ref,
        undefined       // note
    ];

    let didPublish = false;

    try {
        console.log("[ratifier] processRatification start", { jobKey, attemptToken, organismKey, cap, type, hash, path });
        const handle = {
            publish: async () => {
                if (didPublish) throw new Error("Already published");
                didPublish = true;
                await publish(packet);
            },
            get key() {
                return `${jobKey}\0${ratifierKey}\0${organismKey}\0${attemptToken}`;
            },
            get cap() {
                return cap;
            },
            get attemptToken() {
                return attemptToken;
            },
            get jobKey() {
                return jobKey;
            },
            get type() {
                return type;
            },
            get hash() {
                return hash;
            },
            get path() {
                return path;
            },
            get meta() {
                return meta;
            },
            get value() {
                return meta?.value;
            },
            determination: setter(packet, 3, v => typeof v === "string"),
            tier: setter(packet, 4, v => typeof v === "string"),
            note: setter(packet, 7, v => typeof v === "string")
        };
        await projector(handle);
        console.log("[ratifier] projector completed", { jobKey, attemptToken, didPublish });
    } catch (e) {
        console.error("Projector Error:", e);
        return null;
    }

    return didPublish ? packet : null;
}

function setter(obj, key, validation) {
    return {
        set: value => {
            if (validation && !validation(value)) throw new Error("Invalid value");
            obj[key] = value;
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export { ensureRatifier }
