import b4a from "b4a";

const MAX_LABEL_BYTES = 128;

export function assertLabelBounded(v, max = MAX_LABEL_BYTES) {
    if (v == null) return;               // allow null/undefined if you want optional
    if (typeof v !== "string") throw new Error("discovery label must be a string");
    const n = b4a.byteLength(v, "utf8");
    if (n > max) throw new Error(`discovery label too long (${n} > ${max} bytes)`);
}

export function stageAssertLabelBounded(max) {
    return v => assertLabelBounded(v, max);
}