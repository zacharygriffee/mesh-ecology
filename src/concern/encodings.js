import c from "compact-encoding";
import {
  assertBoundedUtf8,
  assertBoundedJson,
  hasNonEmpty,
  hasObject
} from "../enc/validators.js";
import { OP } from "./keys.js";

const CAP_MAX_BYTES = 256;
const WORK_RESULT_MAX_BYTES = 256;
const JOB_MAX_BYTES = 16000;
const PATH_MAX_BYTES = 256;
const META_MAX_BYTES = 16000;
const NOTE_MAX_BYTES = 256;

function assertCap(cap) {
  assertBoundedUtf8("cap", cap, CAP_MAX_BYTES);
}

function assertJobSize(job) {
  assertBoundedJson("job.in", job, JOB_MAX_BYTES);
}

const jobEncoding = {
  preencode(state, { in: job, cap }) {
    assertJobSize(job);
    assertCap(cap);
    c.json.preencode(state, job);
    c.utf8.preencode(state, cap);
  },
  encode(state, { in: job, cap }) {
    assertJobSize(job);
    assertCap(cap);
    c.json.encode(state, job);
    c.utf8.encode(state, cap);
  },
  decode(state) {
    const job = c.json.decode(state);
    const cap = c.utf8.decode(state);
    return { in: job, cap };
  }
};

function assertWorkResultSize(workResult) {
  assertBoundedUtf8("work result", workResult, WORK_RESULT_MAX_BYTES);
}

function assertPathSize(path) {
  assertBoundedUtf8("path", path, PATH_MAX_BYTES);
}

function assertMetaSize(meta) {
  assertBoundedJson("meta", meta, META_MAX_BYTES);
}

function validateRef(ref) {
  const hasPath = !!ref.p;
  const hasHash = !!ref.h;
  assertWorkResultSize(ref.t);
  if (hasPath) assertPathSize(ref.p);
  return { hasPath, hasHash };
}

const refEncoding = {
  preencode(state, ref) {
    const { hasPath, hasHash } = validateRef(ref);
    c.utf8.preencode(state, ref.t);
    c.fixed32.preencode(state, ref.k);
    c.bool.preencode(state, hasPath);
    if (hasPath) c.utf8.preencode(state, ref.p);
    c.bool.preencode(state, hasHash);
    if (hasHash) c.fixed32.preencode(state, ref.h);
    c.fixed32.preencode(state, ref.a);
  },
  encode(state, ref) {
    const { hasPath, hasHash } = validateRef(ref);
    c.utf8.encode(state, ref.t);
    c.fixed32.encode(state, ref.k);
    c.bool.encode(state, hasPath);
    if (hasPath) c.utf8.encode(state, ref.p);
    c.bool.encode(state, hasHash);
    if (hasHash) c.fixed32.encode(state, ref.h);
    c.fixed32.encode(state, ref.a);
  },
  decode(state) {
    const result = {};
    result.t = c.utf8.decode(state);
    result.k = c.fixed32.decode(state);
    const hasPath = c.bool.decode(state);
    if (hasPath) result.p = c.utf8.decode(state);
    const hasHash = c.bool.decode(state);
    if (hasHash) result.h = c.fixed32.decode(state);
    result.a = c.fixed32.decode(state);
    return result;
  }
};

function assertNoteSize(note) {
  assertBoundedUtf8("note", note, NOTE_MAX_BYTES);
}

function validatePubMeta(o) {
  assertCap(o.cap);
  const hasMeta = hasObject(o.meta);
  if (hasMeta) assertMetaSize(o.meta);
  return hasMeta;
}

function validateRatNote(o) {
  assertCap(o.cap);
  const hasNote = hasNonEmpty(o.n);
  if (hasNote) assertNoteSize(o.n);
  return hasNote;
}

const econEncoding = {
  preencode(state, o) {
    const {
      mode,
      attemptBurn,
      ratBurn
    } = o;
    c.uint8.preencode(state, mode);
    c.uint64.preencode(state, attemptBurn);
    c.uint64.preencode(state, ratBurn);
  },
  encode(state, o) {
    const {
      mode,
      attemptBurn,
      ratBurn
    } = o;
    c.uint8.encode(state, mode);
    c.uint64.encode(state, attemptBurn);
    c.uint64.encode(state, ratBurn);
  },
  decode(state) {
    const result = {};
    result.mode = c.uint8.decode(state);
    result.attemptBurn = c.uint64.decode(state);
    result.ratBurn = c.uint64.decode(state);
    return result;
  }
};

const stateEncoding = {
  preencode(state, o) {
    const {
      v,
      econ = {}
    } = o;
    c.uint64.preencode(state, v);
    econEncoding.preencode(state, econ);
  },
  encode(state, o) {
    const {
      v,
      econ = {}
    } = o;
    c.uint64.encode(state, v);
    econEncoding.encode(state, econ);
  },
  decode(state) {
    const result = {};
    result.v = c.uint64.decode(state);
    result.econ = econEncoding.decode(state);
    return result;
  }
};

const baseEncoding = {
  preencode(state, o) {
    const op = o.op;
    c.uint8.preencode(state, op);
    switch (op) {
      case OP.STATE: {
        stateEncoding.preencode(state, o);
        break;
      }
      case OP.ADD: {
        c.fixed32.preencode(state, o.key);
        break;
      }
      case OP.JOB: {
        c.fixed32.preencode(state, o.key);
        jobEncoding.preencode(state, o.data);
        break;
      }
      case OP.PUB: {
        const hasMeta = validatePubMeta(o);
        c.fixed32.preencode(state, o.key);
        c.utf8.preencode(state, o.cap);
        refEncoding.preencode(state, o.ref);
        c.bool.preencode(state, hasMeta);
        if (hasMeta) c.json.preencode(state, o.meta);
        break;
      }
      case OP.RAT: {
        const hasNote = validateRatNote(o);

        c.fixed32.preencode(state, o.jK);
        c.fixed32.preencode(state, o.oK);
        c.fixed32.preencode(state, o.aK);
        c.uint8.preencode(state, o.d);
        c.uint16.preencode(state, o.tr);
        c.utf8.preencode(state, o.cap);
        refEncoding.preencode(state, o.ref);
        c.bool.preencode(state, hasNote);
        if (hasNote) c.utf8.preencode(state, o.n);

        break;
      }
    }
  },
  encode(state, o) {
    const op = o.op;
    c.uint8.encode(state, op);
    switch (op) {
      case OP.STATE: {
        stateEncoding.encode(state, o);
        break;
      }
      case OP.ADD: {
        c.fixed32.encode(state, o.key);
        break;
      }
      case OP.JOB: {
        c.fixed32.encode(state, o.key);
        jobEncoding.encode(state, o.data);
        break;
      }
      case OP.PUB: {
        const hasMeta = validatePubMeta(o);
        c.fixed32.encode(state, o.key);
        c.utf8.encode(state, o.cap);
        refEncoding.encode(state, o.ref);
        c.bool.encode(state, hasMeta);
        if (hasMeta) c.json.encode(state, o.meta);
        break;
      }
      case OP.RAT: {
        const hasNote = validateRatNote(o);

        c.fixed32.encode(state, o.jK);
        c.fixed32.encode(state, o.oK);
        c.fixed32.encode(state, o.aK);
        c.uint8.encode(state, o.d);
        c.uint16.encode(state, o.tr);
        c.utf8.encode(state, o.cap);
        refEncoding.encode(state, o.ref);
        c.bool.encode(state, hasNote);
        if (hasNote) c.utf8.encode(state, o.n);
        break;
      }
    }
  },
  decode(state) {
    const result = {};
    result.op = c.uint8.decode(state);
    switch (result.op) {
      case OP.STATE: {
        Object.assign(result, stateEncoding.decode(state));
        break;
      }
      case OP.ADD: {
        result.key = c.fixed32.decode(state);
        break;
      }
      case OP.JOB: {
        result.key = c.fixed32.decode(state);
        result.data = jobEncoding.decode(state);
        break;
      }
      case OP.PUB: {
        result.key = c.fixed32.decode(state);
        result.cap = c.utf8.decode(state);
        result.ref = refEncoding.decode(state);
        const hasMeta = c.bool.decode(state);
        if (hasMeta) result.meta = c.json.decode(state);
        break;
      }
      case OP.RAT: {
        result.jK = c.fixed32.decode(state);
        result.oK = c.fixed32.decode(state);
        result.aK = c.fixed32.decode(state);
        result.d = c.uint8.decode(state);
        result.tr = c.uint16.decode(state);
        result.cap = c.utf8.decode(state);
        result.ref = refEncoding.decode(state);
        const hasNote = c.bool.decode(state);
        if (hasNote) result.n = c.utf8.decode(state);
        break;
      }
    }
    return result;
  }
};

// INTENT(phase-c2-style): Keep derived PUB leaf encoding byte-for-byte stable for concern view traversal.
const viewPubEncoding = {
  preencode(state, o) {
    const hasMeta = validatePubMeta(o);
    c.fixed32.preencode(state, o.oK);
    c.utf8.preencode(state, o.cap);
    refEncoding.preencode(state, o.ref);
    c.bool.preencode(state, hasMeta);
    if (hasMeta) c.json.preencode(state, o.meta);
  },
  encode(state, o) {
    const hasMeta = validatePubMeta(o);
    c.fixed32.encode(state, o.oK);
    c.utf8.encode(state, o.cap);
    refEncoding.encode(state, o.ref);
    c.bool.encode(state, hasMeta);
    if (hasMeta) c.json.encode(state, o.meta);
  },
  decode(state) {
    const result = {};
    result.oK = c.fixed32.decode(state);
    result.cap = c.utf8.decode(state);
    result.ref = refEncoding.decode(state);
    const hasMeta = c.bool.decode(state);
    if (hasMeta) result.meta = c.json.decode(state);
    return result;
  }
};

// INTENT(phase-c2-style): Keep derived RAT leaf encoding byte-for-byte stable for concern view traversal.
const viewRatEncoding = {
  preencode(state, o) {
    const hasNote = validateRatNote(o);

    c.uint8.preencode(state, o.d);
    c.uint16.preencode(state, o.tr);
    c.utf8.preencode(state, o.cap);
    refEncoding.preencode(state, o.ref);

    c.bool.preencode(state, hasNote);
    if (hasNote) c.utf8.preencode(state, o.n);
  },
  encode(state, o) {
    const hasNote = validateRatNote(o);

    c.uint8.encode(state, o.d);
    c.uint16.encode(state, o.tr);
    c.utf8.encode(state, o.cap);
    refEncoding.encode(state, o.ref);

    c.bool.encode(state, hasNote);
    if (hasNote) c.utf8.encode(state, o.n);
  },
  decode(state) {
    const result = {};
    result.d = c.uint8.decode(state);
    result.tr = c.uint16.decode(state);
    result.cap = c.utf8.decode(state);
    result.ref = refEncoding.decode(state);

    const hasNote = c.bool.decode(state);
    if (hasNote) result.n = c.utf8.decode(state);
    return result;
  }
};

export {
  jobEncoding,
  refEncoding,
  econEncoding,
  stateEncoding,
  baseEncoding,
  viewPubEncoding,
  viewRatEncoding
};
