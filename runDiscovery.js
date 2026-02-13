import hypercoreId from "hypercore-id-encoding";
import Repl from "repl";
import {addConcern, addWriter, ensureDiscoverySurface} from "./src/discovery.js";
import {createKeyPair, defaultTopics} from "./src/util/createKeyPair.js";
import {ensureCorestore} from "./src/ensureCorestore.js";
import Hyperswarm from "hyperswarm";

const keyPair = createKeyPair("discovery");
const [ testTopic ] = defaultTopics(1);
const swarm = new Hyperswarm({ keyPair });
const cs = ensureCorestore("./store/discovery");
const done = cs.findingPeers();
swarm.join(testTopic);
swarm.flush().then(done, done);

const discovery = await ensureDiscoverySurface(cs);
console.log("discovery key", hypercoreId.encode(discovery.key));
swarm.on("connection", socket => discovery.replicate(socket));
const repl = Repl.start({ prompt: "discovery> " });
Object.assign(repl.context, {
    get key() { return hypercoreId.encode(discovery.key); },
    get discovery() { return discovery; },
    get isWritable() { return discovery.writable; },
    join,
    addWriter: addWriter.bind(null, discovery),
    addConcern: addConcern.bind(null, discovery)
});

function join(z32Topic) {
    swarm.join(hypercoreId.decode(z32Topic));
}