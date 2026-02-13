import c from "compact-encoding";
import b4a from "b4a";
import {createFakeSwarm} from "fakeswarm";
import {mkTempDir} from "./_shared/harness.js";
import Corestore from "corestore";
import Autobase from "autobase";
import Krypto from "hypercore-crypto";
import {getWait} from "../src/getWait.js";

const TOPIC = Krypto.randomBytes(32);

const encoderBounded = (n) => {
    return {
        preencode(state, num) {
            if (num > n) throw new Error("encoderBounded: " + n);
            c.uint8.preencode(state, num);
        },
        encode(state, num) {
            if (num > n) throw new Error("encoderBounded: " + n);
            c.uint8.encode(state, num);
        },
        decode(state) {
            const num = c.uint8.decode(state);
            if (num > n) throw new Error("encoderBounded: " + n);
            return num;
        }
    }
}
const dir1 = mkTempDir("aea-1");
const store1 = new Corestore(dir1);
const dir2 = mkTempDir("aea-2");
const store2 = new Corestore(dir2);
const swarm1 = createFakeSwarm();
const swarm2 = createFakeSwarm();

const key = await Autobase.getLocalKey(store1);
const base1 = new Autobase(store1, key, {
    valueEncoding: c.uint8,
    open: open.bind(null, 5), apply: apply.bind(null, "base1")
});

const base2 = new Autobase(store2, key, {
    valueEncoding: c.uint8,
    open: open.bind(null, 10), apply: apply.bind(null, "base2")
});

swarm1.on("connection", socket => base1.replicate(socket));
swarm2.on("connection", socket => base2.replicate(socket));

swarm1.join(TOPIC);
swarm2.join(TOPIC);

await base1.update();
await base1.append(9);
await base2.update({wait: true});
const result = await getWait(base2.view, 0);
console.log(result);


await Promise.all([
    swarm1.close(),
    swarm2.close()
])

async function apply(baseLabel, update, view, host) {
    for await (const { value } of update) {
        console.log("Trying to append of", baseLabel);
        await view.append(value);
    }
}

function open(boundedNum, store) {
    return store.get({name: "view", valueEncoding: encoderBounded(boundedNum)});
}