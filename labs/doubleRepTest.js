import { createFakeSwarm } from "fakeswarm";
import { tmpdir } from "os";
import { mkTempDir } from "./_shared/harness.js";
import Corestore from "corestore";
import Krypto from "hypercore-crypto";

const topic = Krypto.randomBytes(32);

const swarm1 = createFakeSwarm();
const swarm2 = createFakeSwarm();

swarm1.join(topic);
swarm2.join(topic);

const dir1 = mkTempDir("test-double-rep-1");
const dir2 = mkTempDir("test-double-rep-2");

const cs1 = new Corestore(dir1);
const cs2 = new Corestore(dir2);

swarm1.on("connection", conn => {
    cs1.replicate(conn);
});
swarm2.on("connection", conn => {
    cs2.replicate(conn);
});

const core1 = cs1.get({name: "hello", valueEncoding: "utf8"});
await core1.ready();
const core2 = cs2.get({key: core1.key, valueEncoding: "utf8"});
await core2.ready();

await core1.append("hello how are you");
await core2.update();
const result = await core2.get(0);
console.log(result);