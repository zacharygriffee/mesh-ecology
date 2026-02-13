import Autobase from "autobase";
import idEncoding from "hypercore-id-encoding";
import b4a from "b4a";
import c from "compact-encoding";
import {assertLabelBounded} from "./util/assertLabelBounded.js";
import {replicateResource} from "./replicateBase.js";

const KIND = {
    "DISCOVERY": 1,
    "CONCERN": 2
}

const OP = {
    "APPEND": 1,
    "ADD": 2
}

const discoveryViewEncoding = {
    preencode(state, { t, k32, v }) {
        c.uint8.preencode(state, t);
        c.fixed32.preencode(state, k32);

        const hasV = v != null && v !== "";
        c.uint8.preencode(state, hasV ? 1 : 0);
        if (hasV) { assertLabelBounded(v); c.utf8.preencode(state, v); }
    },

    encode(state, { t, k32, v }) {
        c.uint8.encode(state, t);
        c.fixed32.encode(state, k32);

        const hasV = v != null && v !== "";
        c.uint8.encode(state, hasV ? 1 : 0);
        if (hasV) { assertLabelBounded(v); c.utf8.encode(state, v); }
    },

    decode(state) {
        const t = c.uint8.decode(state);
        const k32 = c.fixed32.decode(state);
        const hasV = c.uint8.decode(state) === 1;
        const v = hasV ? c.utf8.decode(state) : "";
        return { t, k32, v };
    }
};



const discoveryEncoding = {
    preencode(state, {op, k32, v}) {
        c.uint8.preencode(state, op);
        if (op === OP.ADD) c.fixed32.preencode(state, k32);
        if (op === OP.APPEND) discoveryViewEncoding.preencode(state, v);
    },
    encode(state, {op, k32, v}) {
        c.uint8.encode(state, op);
        if (op === OP.ADD) c.fixed32.encode(state, k32);
        if (op === OP.APPEND) discoveryViewEncoding.encode(state, v);
    },
    decode(state) {
        const op = c.uint8.decode(state);
        let k32, v;
        if (op === OP.ADD) k32 = c.fixed32.decode(state);
        if (op === OP.APPEND) v = discoveryViewEncoding.decode(state);
        return {op, k32, v}
    }
}


async function ensureDiscoverySurface(cs, config = {}, swarm) {
    const key = config.key || await Autobase.getLocalKey(cs);

    const base = new Autobase(cs, key, {
        valueEncoding: discoveryEncoding,
        open,
        apply
    });

    // Optional convenience: wire replication if a swarm/transport is provided.
    // Discovery remains advertise/scan only; capability is unchanged by this hookup.
    if (swarm) replicateResource(base, swarm);

    await base.ready();
    return base;
}

function open(store) {
    return store.get({name: "view", valueEncoding: discoveryViewEncoding});
}

async function apply(updates, view, host) {
    // Autobase applies Hypercore entries; we mirror them into the Hyperbee view.
    for await (const update of updates) {
        const {value} = update;
        switch (value.op) {
            case OP.ADD: {
                await host.addWriter(value.k32);
                break;
            }
            case OP.APPEND: {
                await view.append(value.v);
                break;
            }
        }
    }
}

const keyExists = async (view, discoveryKey32Buf) => {
    for await (const {k32} of view.createReadStream())
        if (b4a.equals(k32, discoveryKey32Buf)) return true;
    return false;
}

async function addConcern(discovery, key, labelMax128Length) {
    if (!discovery.writable) throw new Error("discovery is not writable");
    const keyBuf = b4a.isBuffer(key) ? key : idEncoding.decode(key);
    if (await keyExists(discovery.view, keyBuf)) return;
    await discovery.append({op: OP.APPEND, v: {v: labelMax128Length, k32: keyBuf, t: KIND.CONCERN}});
    await discovery.update();
}

async function addDiscovery(discovery, key, labelMax128Length) {
    if (!discovery.writable) throw new Error("discovery is not writable");
    const keyBuf = b4a.isBuffer(key) ? key : idEncoding.decode(key);
    if (await keyExists(discovery.view, keyBuf)) return;
    await discovery.append({op: OP.APPEND, v: {v: labelMax128Length, k32: keyBuf, t: KIND.DISCOVERY}});
    await discovery.update();
}

async function addWriter(discovery, key) {
    if (!discovery.writable) throw new Error("discovery is not writable");
    const keyBuf = b4a.isBuffer(key) ? key : idEncoding.decode(key);
    await discovery.append({op: OP.ADD, k32: keyBuf});
    await discovery.update();
}

export {
    ensureDiscoverySurface,
    addConcern,
    addDiscovery,
    addWriter,
    discoveryViewEncoding,
    discoveryEncoding,
    KIND,
    OP
}
