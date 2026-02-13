import Repl from "repl";
import dot from "dotenv";
import { createKeyPair, defaultTopics } from "./src/util/createKeyPair.js";
import { ensureCorestore } from "./src/ensureCorestore.js";
import { ensureRatifier } from "./src/ratifier.legacy.js";
import Hyperswarm from "hyperswarm";

dot.config();

const DISCOVERY_ENV = process.env.DISCOVERY_ID;
const keyPair = createKeyPair("ratifier");
const [testTopic] = defaultTopics(1);
const swarm = new Hyperswarm({ keyPair });
swarm.join(testTopic);

const cs = ensureCorestore("./store/ratifier");
const done = cs.findingPeers();
swarm.flush().then(done, done);
swarm.on("connection", socket => cs.replicate(socket));

const ratifier = await ensureRatifier(cs, swarm);
if (DISCOVERY_ENV) await ratifier.addDiscovery(DISCOVERY_ENV);

const repl = Repl.start({ prompt: "ratifier> " });
Object.assign(repl.context, {
  ...ratifier,
  addDiscovery(baseKey) {
    return ratifier.addDiscovery(baseKey);
  },
  debugNextDiscovery() {
    return ratifier.nextDiscovery(async ({ cap, determination, tier, note, publish }) => {
      if (cap !== "debug.meta.value/v1") return null;
      determination.set("accept");
      tier.set("debug");
      note.set("auto-accepted by debug projector");
      await publish();
    });
  }
});
