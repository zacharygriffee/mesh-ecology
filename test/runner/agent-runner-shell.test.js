import test from "brittle";
import Corestore from "corestore";
import crypto from "crypto";
import fs from "fs";
import b4a from "b4a";
import createFakeSwarm from "fakeswarm";
import idEncoding from "hypercore-id-encoding";
import Autobase from "autobase";
import {createRunner} from "../../src/agent/runner.js";

import {addConcern, addDiscovery, ensureDiscoverySurface, addWriter as addDiscoveryWriter} from "../../src/discovery.js";
import {ensureConcernSurface} from "../../src/concern.js";
import {createRunnerShell} from "../../src/agent/runner-shell.js";
import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";

const topicSeed = crypto.randomBytes(32);

async function createDiscoveryHost({swarm}) {
    const dir = mkTmp("disc-host-");
    const store = new Corestore(dir);
    await store.ready?.();
    const disc = await ensureDiscoverySurface(store, {}, swarm); // creator open (writable)
    await addDiscoveryWriter(disc, disc.local.key);
    return {dir, store, disc};
}

async function advertise(disc, keyBuf) {
    // if (!advertise._addedWriter) {
    //   await addDiscoveryWriter(disc, disc.local.key);
    //   await disc.update({ wait: true });
    //   advertise._addedWriter = true;
    // }
    await addConcern(disc, keyBuf, "label");
    await disc.update({wait: true});
}

async function advertiseDiscovery(disc, keyBuf) {
    await addDiscovery(disc, keyBuf, "discovery-label");
    await disc.update({wait: true});
}

async function createConcernHost({swarm}) {
    const dir = mkTmp("concern-host-");
    const store = new Corestore(dir);
    await store.ready?.();
    const base = await ensureConcernSurface(store.namespace("concern"), swarm);
    await base.ready();
    await base.update();
    return {dir, store, base, key: base.key};
}

function cleanupDirs(...dirs) {
    dirs.forEach((d) => {
        if (!d) return;
        fs.rmSync(d, {recursive: true, force: true});
    });
}

async function closeMaybe(obj) {
    await obj?.close?.().catch(() => {});
}

function makeSwarmPair() {
    const topics = new Map();
    const a = createFakeSwarm({topics});
    const b = createFakeSwarm({topics});
    a.join(topicSeed);
    b.join(topicSeed);
    return {a, b};
}

async function tickUntil({runner, swarmHost, swarmRunner, predicate, max = 15}) {
    for (let i = 0; i < max; i++) {
        await safeFlush(swarmHost, 200);
        await safeFlush(swarmRunner, 200);
        await runner.tick();
        if (await predicate()) return true;
    }
    return false;
}

test("warmset capped to warmN and deterministic", async (t) => {
    let swarmHost;
    let swarmRunner;
    let discDir;
    let discStore;
    let disc;
    let runnerDir;
    let runnerStore;
    let runner;
    const concernHosts = [];

    try {
        ({a: swarmHost, b: swarmRunner} = makeSwarmPair());
        t.comment("warmset start");

        ({dir: discDir, store: discStore, disc} = await createDiscoveryHost({swarm: swarmHost}));
        const discKeyZ = idEncoding.encode(disc.key);

        for (let i = 0; i < 3; i++) {
            const host = await createConcernHost({swarm: swarmHost});
            concernHosts.push(host);
            await advertise(disc, host.key);
        }

        runnerDir = mkTmp("runner-");
        runnerStore = new Corestore(runnerDir);
        await runnerStore.ready?.();

        runner = await createRunner({
            role: "org",
            corestore: runnerStore,
            swarm: swarmRunner,
            discoveryKeys: [discKeyZ],
            warmN: 2,
            warmupBudget: {maxTicks: 0, maxMs: 0, minViewReadable: false},
            log: {
                log: () => {
                }
            },
        });
        t.comment("runner created for warmset cap");

        await tickUntil({
            runner,
            swarmHost,
            swarmRunner,
            predicate: () => runner.getStatus().warm.some((s) => s.status === "warmed"),
            max: 20,
        });
        t.comment("warmset tick complete");

        const warmStatuses = runner.getStatus().warm.filter((s) => s.status === "warmed");
        t.is(warmStatuses.length, 2);
    } finally {
        await closeMaybe(runner);
        await closeMaybe(runnerStore);
        await closeMaybe(disc);
        await closeMaybe(discStore);
        await closeSwarm(swarmHost);
        await closeSwarm(swarmRunner);
        for (const {base, store} of concernHosts) {
            await closeMaybe(base);
            await closeMaybe(store);
        }
        cleanupDirs(discDir, runnerDir, ...concernHosts.map((h) => h.dir));
    }
});

test("cursor persists across restart", async (t) => {
    let swarmHost;
    let swarmRunner;
    let discDir;
    let discStore;
    let disc;
    let runnerDir;
    let runnerStore;
    let shell1;
    let shell2;
    const concernHosts = [];
    let newHost = null;

    try {
        ({a: swarmHost, b: swarmRunner} = makeSwarmPair());

        ({dir: discDir, store: discStore, disc} = await createDiscoveryHost({swarm: swarmHost}));
        const discKeyZ = idEncoding.encode(disc.key);

        for (let i = 0; i < 2; i++) {
            const host = await createConcernHost({swarm: swarmHost});
            concernHosts.push(host);
            await advertise(disc, host.key);
        }

        runnerDir = mkTmp("runner-");
        runnerStore = new Corestore(runnerDir);
        await runnerStore.ready?.();

        const makeRunner = () =>
            createRunner({
                role: "org",
                corestore: runnerStore,
                swarm: swarmRunner,
                discoveryKeys: [discKeyZ],
                warmN: 1,
                warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false },
                log: { log: () => {} },
            });

        shell1 = await makeRunner();
        await tickUntil({
            runner: shell1,
            swarmHost,
            swarmRunner,
            predicate: () => shell1.getStatus().warm.some((w) => w.status === "warmed"),
        });
        t.comment("cursor warm complete");
        await closeMaybe(shell1);
        shell1 = null;

        newHost = await createConcernHost({swarm: swarmHost});
        await advertise(disc, newHost.key);

        shell2 = await makeRunner();
        await tickUntil({
            runner: shell2,
            swarmHost,
            swarmRunner,
            predicate: () => shell2.getStatus().warm.some((w) => w.status === "warmed"),
            max: 20,
        });
        const warm2 = shell2.getStatus().warm.filter((w) => w.status === "warmed").map((w) => w.keyHex);
        t.is(warm2.length, 1);
        t.is(warm2[0], b4a.toString(newHost.key, "hex"));
    } finally {
        await closeMaybe(shell2);
        await closeMaybe(shell1);
        await closeMaybe(runnerStore);
        await closeMaybe(disc);
        await closeMaybe(discStore);
        await closeSwarm(swarmHost);
        await closeSwarm(swarmRunner);
        for (const {base, store} of [...concernHosts, ...(newHost ? [newHost] : [])]) {
            await closeMaybe(base);
            await closeMaybe(store);
        }
        cleanupDirs(discDir, runnerDir, ...concernHosts.map((h) => h.dir), newHost?.dir);
    }
});

test("runner never calls addWriter on discovery or concern", async (t) => {
    let swarmHost;
    let swarmRunner;
    let discDir;
    let discStore;
    let disc;
    let concernHost;
    let runnerDir;
    let runnerStore;
    let runner;
    let originalAddWriter = null;
    let guardActive = false;

    try {
        ({a: swarmHost, b: swarmRunner} = makeSwarmPair());

        let addWriterCalledDuringRunner = false;
        originalAddWriter = Autobase.prototype.addWriter;
        Autobase.prototype.addWriter = function patchedAddWriter(...args) {
            if (guardActive) addWriterCalledDuringRunner = true;
            return originalAddWriter.apply(this, args);
        };

        ({dir: discDir, store: discStore, disc} = await createDiscoveryHost({swarm: swarmHost}));
        const discKeyZ = idEncoding.encode(disc.key);
        concernHost = await createConcernHost({swarm: swarmHost});
        await advertise(disc, concernHost.key);
        await closeMaybe(concernHost.store);

        runnerDir = mkTmp("runner-");
        runnerStore = new Corestore(runnerDir);
        await runnerStore.ready?.();

        await swarmHost.flush();
        await swarmRunner.flush();

        runner = await createRunnerShell({
            role: "org",
            corestore: runnerStore,
            swarm: swarmRunner,
            discoveryKeys: [discKeyZ],
            warmN: 1,
            log: {
                log: () => {
                }
            },
        });
        t.comment("runner shell created");

        guardActive = true;
        await runner.tick();
        guardActive = false;

        t.is(addWriterCalledDuringRunner, false);
    } finally {
        guardActive = false;
        if (originalAddWriter) Autobase.prototype.addWriter = originalAddWriter;
        await closeMaybe(runner);
        await closeMaybe(runnerStore);
        await closeMaybe(concernHost?.base);
        await closeMaybe(concernHost?.store);
        await closeMaybe(disc);
        await closeMaybe(discStore);
        await closeSwarm(swarmHost);
        await closeSwarm(swarmRunner);
        cleanupDirs(discDir, runnerDir, concernHost?.dir);
    }
});

test("runner shell follows nested discovery advertisements", async (t) => {
    let swarmHost;
    let swarmRunner;
    let rootDir;
    let rootStore;
    let rootDisc;
    let childDir;
    let childStore;
    let childDisc;
    let concernHost;
    let runnerDir;
    let runnerStore;
    let runner;

    try {
        ({a: swarmHost, b: swarmRunner} = makeSwarmPair());

        ({dir: rootDir, store: rootStore, disc: rootDisc} = await createDiscoveryHost({swarm: swarmHost}));
        ({dir: childDir, store: childStore, disc: childDisc} = await createDiscoveryHost({swarm: swarmHost}));
        concernHost = await createConcernHost({swarm: swarmHost});
        await concernHost.base.append({ op: 5, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } }, { optimistic: false });
        await concernHost.base.update({ wait: true });

        await advertiseDiscovery(rootDisc, childDisc.key);
        await advertise(childDisc, concernHost.key);

        runnerDir = mkTmp("runner-");
        runnerStore = new Corestore(runnerDir);
        await runnerStore.ready?.();

        runner = await createRunnerShell({
            role: "org",
            corestore: runnerStore,
            swarm: swarmRunner,
            discoveryKeys: [idEncoding.encode(rootDisc.key)],
            warmN: 1,
            log: { log: () => {} },
        });

        const warmed = await tickUntil({
            runner,
            swarmHost,
            swarmRunner,
            predicate: async () => runner.getWarm().some((w) => b4a.equals(w.keyBuf, concernHost.key)),
            max: 20,
        });

        t.ok(warmed, "runner shell warms concern discovered via nested discovery");
        t.is(runner.getWarm()[0]?.base?.writable, false, "runner shell keeps warmed concerns readonly by default");
    } finally {
        await closeMaybe(runner);
        await closeMaybe(runnerStore);
        await closeMaybe(concernHost?.base);
        await closeMaybe(concernHost?.store);
        await closeMaybe(rootDisc);
        await closeMaybe(rootStore);
        await closeMaybe(childDisc);
        await closeMaybe(childStore);
        await closeSwarm(swarmHost);
        await closeSwarm(swarmRunner);
        cleanupDirs(rootDir, childDir, runnerDir, concernHost?.dir);
    }
});
