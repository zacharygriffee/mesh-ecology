import hypercoreId from "hypercore-id-encoding";
import {
    addWriter,
    ensureConcernSurface,
    createJob,
    getPublishView,
    getPublishViewByJob,
    getJobView
} from "./src/concern.js";
import Repl from "repl";
import {createKeyPair, defaultTopics} from "./src/util/createKeyPair.js";
import {ensureCorestore} from "./src/ensureCorestore.js";
import Hyperswarm from "hyperswarm";
const keyPair = createKeyPair("concern");
const [ testTopic ] = defaultTopics(1);
const swarm = new Hyperswarm({keyPair});
swarm.join(testTopic);

const cs = ensureCorestore("./store/concern");
const done = cs.findingPeers();
swarm.flush().then(done, done);
const concern = await ensureConcernSurface(cs, swarm);
console.log("concern key", hypercoreId.encode(concern.key));
swarm.on("connection", socket => {
    socket.on("error", e => {
        console.error("socket error", e);
    });
    return concern.replicate(socket);
});

const repl = Repl.start({ prompt: "concern> " });
Object.assign(repl.context, {
    get key() { return hypercoreId.encode(concern.key); },
    get CONCERN() { return concern; },
    get isWritable() { return concern.writable; },
    addWriter: addWriter.bind(null, concern),
    createJob: createJob.bind(null, concern),
    getJobView: getJobView.bind(null, concern),
    getPublishView: getPublishView.bind(null, concern),
    getPublishViewByJob: getPublishViewByJob.bind(null, concern)
});

