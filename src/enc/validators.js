import b4a from "b4a";

function assertBoundedUtf8(label, value, maxBytes) {
    if (typeof value !== "string") throw new Error(`${label} must be a string`);
    const n = b4a.byteLength(value, "utf8");
    if (n > maxBytes) throw new Error(`${label} too big (${n} > ${maxBytes} bytes)`);
}

function assertBoundedJson(label, value, maxBytes) {
    const s = JSON.stringify(value);
    const n = b4a.byteLength(s, "utf8");
    if (n > maxBytes) throw new Error(`${label} too big (${n} > ${maxBytes} bytes)`);
}

const hasObject = value => !!value && typeof value === "object";

const hasNonEmpty = value => !!value && value !== "";

export {
    assertBoundedUtf8,
    assertBoundedJson,
    hasObject,
    hasNonEmpty
};
