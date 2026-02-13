import Repl from "repl";
import dot from "dotenv";
import {createKeyPair, defaultTopics} from "./src/util/createKeyPair.js";
import {ensureCorestore} from "./src/ensureCorestore.js";
import {ensureOrganism} from "./src/organism.legacy.js";
import Hyperswarm from "hyperswarm";
dot.config();
const keyPair = createKeyPair("organism");
const DISCOVERY_ENV = process.env.DISCOVERY_ID;
const [ testTopic ] = defaultTopics(1);
const swarm = new Hyperswarm({keyPair});
swarm.join(testTopic);

const cs = ensureCorestore("./store/organism");
const done = cs.findingPeers();
swarm.flush().then(done, done);
swarm.on("connection", socket => cs.replicate(socket));
const organism = await ensureOrganism(cs, swarm);
if (DISCOVERY_ENV) await organism.addDiscovery(DISCOVERY_ENV);
const repl = Repl.start({ prompt: "organism> " });
Object.assign(repl.context, {
    ...organism,
    addDiscovery(baseKey) {
        return organism.addDiscovery(baseKey);
    },
    debugNextDiscovery() {
        return organism.nextDiscovery(async ({ cap, job, type, value, publish }) => {
            if (cap !== "debug.meta.value/v1") return null;
            if (typeof job === "string") {
                type.set("meta.value/v1");
                value.set(job.toUpperCase());
                await publish();
            }
        })
    }
});