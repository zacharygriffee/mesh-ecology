import Autobase from "autobase";
import Hyperbee from "hyperbee";
import idEncoding from "hypercore-id-encoding";
import b4a from "b4a";
import {replicateBase} from "./replicateBase.js";
import c from "compact-encoding";
import {
    OP,
    JOB_KEY,
    PUB_KEY,
    RAT_KEY,
    STATE_KEY,
    ECON_BURN_TOTAL_KEY,
    ECON_LOCK_TOTAL_KEY
} from "./concern/keys.js";
import { createConcernViewGetters } from "./concern/views.js";
import {
    jobEncoding,
    refEncoding,
    stateEncoding,
    baseEncoding,
    viewPubEncoding,
    viewRatEncoding
} from "./concern/encodings.js";
import { normalizeStrictConfigV1 } from "./validity/state.js";
import {
    getStrictState
} from "./concern/strict-state.js";
import { createConcernPublishHelpers } from "./concern/publish.js";
import { apply, applyWithDeps, __setApplyProbe } from "./concern/apply.js";

const DETERMINATION = {
    ACCEPT: 1,
    REJECT: 2,
    REVIEW: 3
}

const ECON_MODE = {
    OFF: 0,
    BURN: 1,
    LOCK: 2
}

async function ensureConcernSurface(cs, swarm, config = {}) {
    const key = config.key ?? await Autobase.getLocalKey(cs);

    const base = new Autobase(cs, key, {
        valueEncoding: baseEncoding,
        open,
        apply,
        optimistic: true
    });

    replicateBase(base, swarm);
    await base.ready();
    return base;
}

function open(store) {
    const core = store.get({name: "view"})
    const bee = new Hyperbee(core, {keyEncoding: c.fixed32, extension: false});
    return bee;
}

function normalizeKeyToBuffer(key) {
    const buff = b4a.isBuffer(key) ? key : idEncoding.decode(key);
    if (buff.length !== 32) throw new Error("key must be 32 bytes");
    return buff;
}

const {
    getPublishView,
    getRatView,
    getJobView,
    getPublishViewByJob
} = createConcernViewGetters({
    JOB_KEY,
    PUB_KEY,
    RAT_KEY,
    jobEncoding,
    viewPubEncoding,
    viewRatEncoding,
    normalizeKeyToBuffer
});

const {
    addWriter,
    createJob,
    genesisConcernSurface,
    publishJobWork,
    publishJobRatification
} = createConcernPublishHelpers({
    OP,
    normalizeKeyToBuffer,
    normalizeStrictConfigV1,
    getStrictState
});

const __test__ = {
    applyWithDeps,
    setApplyProbe: __setApplyProbe,
    keys: {
        ECON_BURN_TOTAL_KEY,
        ECON_LOCK_TOTAL_KEY
    }
};

export {
    ensureConcernSurface,
    addWriter,
    createJob,
    getJobView,
    getPublishView,
    getRatView,
    getPublishViewByJob,
    publishJobWork,
    publishJobRatification,
    genesisConcernSurface,
    getStrictState,
    jobEncoding,
    refEncoding,
    viewPubEncoding,
    viewRatEncoding,
    baseEncoding,
    OP,
    JOB_KEY,
    PUB_KEY,
    RAT_KEY,
    STATE_KEY,
    ECON_BURN_TOTAL_KEY,
    __test__
}
