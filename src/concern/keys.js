import Krypto from "hypercore-crypto";
import b4a from "b4a";

// INTENT(phase-c1-style): Centralize concern protocol opcodes and hashed keyspace identifiers without altering wire/schema values.

const MATERIAL = Krypto.hash(b4a.from("mesh ecology organism, concern, discovery"));
const VERSION = 1;

const OP = {
  JOB: 1,
  PUB: 2,
  RAT: 3,
  ADD: 4,
  STATE: 5
};

const JOB_KEY = Krypto.hash([MATERIAL, ...Krypto.namespace("JOB", VERSION)]);
const PUB_KEY = Krypto.hash([MATERIAL, ...Krypto.namespace("PUB", VERSION)]);
const RAT_KEY = Krypto.hash([MATERIAL, ...Krypto.namespace("RAT", VERSION)]);
const STATE_KEY = Krypto.hash([MATERIAL, ...Krypto.namespace("STATE", VERSION)]);
const ECON_BURN_TOTAL_KEY = Krypto.hash([b4a.from("econ/v1/burn/total")]);
const ECON_LOCK_TOTAL_KEY = Krypto.hash([b4a.from("econ/v1/lock/total")]);

export {
  OP,
  JOB_KEY,
  PUB_KEY,
  RAT_KEY,
  STATE_KEY,
  ECON_BURN_TOTAL_KEY,
  ECON_LOCK_TOTAL_KEY
};
