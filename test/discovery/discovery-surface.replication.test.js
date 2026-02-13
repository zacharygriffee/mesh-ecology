import test from "brittle";
import Corestore from "corestore";
import crypto from "crypto";
import idEncoding from "hypercore-id-encoding";
import createFakeSwarm from "fakeswarm";

import { ensureDiscoverySurface, addConcern, addWriter } from "../../src/discovery.js";
import { replicateResource } from "../../src/replicateBase.js";
import { mkTemp } from "../_helpers/fs.js";
import { flushBoth } from "../_helpers/swarm.js";
import { findByKey } from "../_helpers/view.js";

async function waitFor(predicate, { tries = 100, delayMs = 20 } = {}) {
    for (let i = 0; i < tries; i++) {
        const res = await predicate();
        if (res) return res;
        await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
}

test("ensureDiscoverySurface optional swarm wires replication (convenience path)", async (t) => {
    const topics = new Map();
    const swarmA = createFakeSwarm({ topics });
    const swarmB = createFakeSwarm({ topics });
    const topic = crypto.randomBytes(32);
    swarmA.join(topic);
    swarmB.join(topic);

    const ta = mkTemp("disc-repl-");
    const tb = mkTemp("disc-repl-");
    const storeA = new Corestore(ta.dir);
    const storeB = new Corestore(tb.dir);
    await storeA.ready?.();
    await storeB.ready?.();

    const discA = await ensureDiscoverySurface(storeA, {}, swarmA);
    const discB = await ensureDiscoverySurface(storeB, { key: discA.key }, swarmB);

    await flushBoth(swarmA, swarmB);

    const concernKey = idEncoding.encode(crypto.randomBytes(32));
    await addConcern(discA, concernKey, "from-A");
    await discA.update({ wait: true });

    await flushBoth(swarmA, swarmB);

    const rec = await waitFor(async () => {
        await discB.update({ wait: true });
        return findByKey(discB.view, concernKey);
    });
    t.ok(rec && rec.t === 2);

    await discA.close();
    await discB.close();
    await storeA.close();
    await storeB.close();
    await swarmA.close();
    await swarmB.close();
    ta.cleanup();
    tb.cleanup();
});

test("ensureDiscoverySurface remains backward compatible without swarm (external replication)", async (t) => {
    const topics = new Map();
    const swarmA = createFakeSwarm({ topics });
    const swarmB = createFakeSwarm({ topics });
    const topic = crypto.randomBytes(32);
    swarmA.join(topic);
    swarmB.join(topic);

    const ta = mkTemp("disc-repl-");
    const tb = mkTemp("disc-repl-");
    const storeA = new Corestore(ta.dir);
    const storeB = new Corestore(tb.dir);
    await storeA.ready?.();
    await storeB.ready?.();

    // No swarm passed into ensureDiscoverySurface: caller wires replication manually.
    const discA = await ensureDiscoverySurface(storeA);
    const discB = await ensureDiscoverySurface(storeB, { key: discA.key });
    replicateResource(discA, swarmA);
    replicateResource(discB, swarmB);

    await flushBoth(swarmA, swarmB);

    const concernKey = idEncoding.encode(crypto.randomBytes(32));
    await addConcern(discA, concernKey, "from-A-manual");
    await discA.update({ wait: true });

    await flushBoth(swarmA, swarmB);

    const rec = await waitFor(async () => {
        await discB.update({ wait: true });
        return findByKey(discB.view, concernKey);
    });
    t.ok(rec && rec.t === 2);

    await discA.close();
    await discB.close();
    await storeA.close();
    await storeB.close();
    await swarmA.close();
    await swarmB.close();
    ta.cleanup();
    tb.cleanup();
});
