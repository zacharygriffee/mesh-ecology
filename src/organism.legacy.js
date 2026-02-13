import idEncoding from "hypercore-id-encoding";
import {ensureDiscoverySurface} from "./discovery.js";
import {ensureConcernSurface, publishJobWork} from "./concern.js";
import {updateWithTimeout} from "./util/updateWithTimeout.js";
import {sleep} from "./util/sleep.js";
import {random32} from "./util/random32.js";

function ensureOrganism(corestore, swarm) {
    const discoveries = [];

    return {
        async addDiscovery(discoveryKey) {
            const keyBuf = idEncoding.decode(discoveryKey);
            const disc = await ensureDiscoverySurface(corestore, {key: keyBuf});
            discoveries.unshift(disc);
            await updateWithTimeout(disc);
        },
        removeDiscovery(discoveryViewKey) {
            const idx = discoveries.indexOf(discoveryViewKey);
            if (idx >= 0) {
                discoveries.splice(idx, 1);
            }
        },
        async nextDiscovery(projector) {
            if (!projector) {
                projector = async (handle) => {
                    console.log("Unimplemented organism projector", handle.key);
                    await sleep(1000);
                }
            }
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
        }
    }
}

async function processConcern(corestore, concernRecord, swarm, projector) {
    const {key, value: concernMeta} = concernRecord;
    console.log("Attempting concern work", key, concernMeta);
    const concernBase = await ensureConcernSurface(corestore.namespace(`org-${key}`), swarm, { key });
    await updateWithTimeout(concernBase);
    const jobBee = concernBase.view.sub("job");
    console.log("concern view", jobBee.core.length);
    if (jobBee.core.length > 0) {
        try {
            for await (const workRecord of jobBee.createReadStream()) {
                const {key, seq, value: {tomb, cap}} = workRecord;
                if (tomb) continue;
                await processWork(projector, workRecord, concernMeta,
                    async packet => {
                        const {cap, ref, meta: jobMeta} = packet;
                        console.log("Publishing work", key, {cap, ref, meta: jobMeta});
                        await publishJobWork(concernBase, key, cap, ref, jobMeta);
                        console.log("Published work", key, {cap, ref, meta: jobMeta});
                    }
                );
            }
        } catch (e) {
            console.error("Concern Work Error:", e);
        }
    }
    await updateWithTimeout(concernBase);
}

async function processWork(projector, workRecord, concernMeta, publish) {
    const {
        key,
        value: work,
        seq
    } = workRecord;

    const {
        in: job,
        cap
    } = work;

    const packet = {
        cap,
        ref: {
            a: null,
            t: "meta.value/v1",
            k: key,
            h: null,
            p: null
        },
        meta: {}
    };

    let didPublish = false;

    try {
        const handle = {
            publish: async () => {
                if (didPublish) throw new Error("Already published");
                didPublish = true;
                if (!packet.ref.a) packet.ref.a = idEncoding.encode(random32());
                return publish(packet);
            },
            get key() {
                return key;
            },
            get cap() {
                return cap;
            },
            get job() {
                return job;
            },
            get concernMeta() {
                return concernMeta;
            },
            attemptToken: setter(packet.ref, "a", v => typeof v === "string" && v.length > 0),
            type: setter(packet.ref, "t", v => typeof v === "string" && v.length > 0),
            hash: setter(packet.ref, "h", v => typeof v === "string" && v.length > 0),
            path: setter(packet.ref, "p", v => typeof v === "string" && v.length > 0),
            meta: setter(packet, "meta", v => typeof v === "object"),
            value: setter(packet.meta, "value", v => typeof v !== "undefined")
        }

        await projector(handle);
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

export {ensureOrganism};
