import Hyperswarm from 'hyperswarm'

const swarm1 = new Hyperswarm()
const swarm2 = new Hyperswarm()

swarm1.joinPeer(swarm2.keyPair.publicKey);
swarm2.joinPeer(swarm1.keyPair.publicKey);

