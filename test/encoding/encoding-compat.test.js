import test from "brittle";
import c from "compact-encoding";
import {
  discoveryViewEncoding,
} from "../../src/discovery.js";
import {
  jobEncoding,
  refEncoding,
  viewPubEncoding,
  viewRatEncoding,
} from "../../src/concern.js";

const buf = (hex) => Buffer.from(hex.repeat(32), "hex");

const fixtures = {
  discoveryView: [
    { t: 1, k32: buf("00"), v: "alpha" },
    { t: 2, k32: buf("11"), v: "" },
    { t: 1, k32: buf("22"), v: "" },
  ],
  ref: [
    { t: "done", k: buf("aa"), p: "path/to", h: buf("bb"), a: buf("cc") },
    { t: "ok", k: buf("dd"), p: "p", a: buf("ee") },
    { t: "noop", k: buf("ff"), a: buf("00") },
  ],
  job: [
    { in: { task: "collect" }, cap: "cap-1" },
    { in: { task: "measure", attempt: 2 }, cap: "cap-2" },
    { in: { id: 3, meta: { nested: true } }, cap: "cap-3" },
  ],
};

fixtures.pub = [
  { oK: buf("01"), cap: "cap-1", ref: fixtures.ref[0], meta: { x: 1 } },
  { oK: buf("02"), cap: "cap-2", ref: fixtures.ref[1] },
  { oK: buf("03"), cap: "cap-3", ref: fixtures.ref[2], meta: {} },
];

fixtures.rat = [
  { d: 1, tr: 5, cap: "cap-1", ref: fixtures.ref[0], n: "note-1" },
  { d: 2, tr: 1, cap: "cap-2", ref: fixtures.ref[1] },
  { d: 3, tr: 0, cap: "cap-3", ref: fixtures.ref[2], n: "ok" },
];

const goldens = {
  discoveryView: [
    "0100000000000000000000000000000000000000000000000000000000000000000105616c706861",
    "02111111111111111111111111111111111111111111111111111111111111111100",
    "01222222222222222222222222222222222222222222222222222222222222222200",
  ],
  ref: [
    "04646f6e65aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0107706174682f746f01bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "026f6bdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd01017000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "046e6f6f70ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000000000",
  ],
  job: [
    "127b227461736b223a22636f6c6c656374227d056361702d31",
    "1e7b227461736b223a226d656173757265222c22617474656d7074223a327d056361702d32",
    "1f7b226964223a332c226d657461223a7b226e6573746564223a747275657d7d056361702d33",
  ],
  pub: [
    "0101010101010101010101010101010101010101010101010101010101010101056361702d3104646f6e65aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0107706174682f746f01bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc01077b2278223a317d",
    "0202020202020202020202020202020202020202020202020202020202020202056361702d32026f6bdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd01017000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00",
    "0303030303030303030303030303030303030303030303030303030303030303056361702d33046e6f6f70ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000000000000000001027b7d",
  ],
  rat: [
    "010500056361702d3104646f6e65aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0107706174682f746f01bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc01066e6f74652d31",
    "020100056361702d32026f6bdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd01017000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00",
    "030000056361702d33046e6f6f70ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000000000000000001026f6b",
  ],
};

const encoders = {
  discoveryView: discoveryViewEncoding,
  ref: refEncoding,
  job: jobEncoding,
  pub: viewPubEncoding,
  rat: viewRatEncoding,
};

function normalize(value) {
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalize(v);
    return out;
  }
  return value;
}

for (const [name, encoder] of Object.entries(encoders)) {
  test(`${name} encoding is stable`, (t) => {
    fixtures[name].forEach((fixture, idx) => {
      const encoded = c.encode(encoder, fixture);
      t.is(encoded.toString("hex"), goldens[name][idx], `golden ${name}[${idx}]`);

      const decoded = c.decode(encoder, encoded);
      t.alike(normalize(decoded), normalize(fixture), `roundtrip ${name}[${idx}]`);
    });
  });
}
