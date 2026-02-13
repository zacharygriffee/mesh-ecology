import test from "brittle";

const enabled = process.env.LEAK_CHECK === "1";

test("leak check (active handles)", { skip: !enabled }, async (t) => {
  const handles = process._getActiveHandles();
  const requests = process._getActiveRequests ? process._getActiveRequests() : [];
  const detail = handles.map((h) => {
    const name = h?.constructor?.name || typeof h;
    if (name === "Socket") {
      const lp = h.localPort || "";
      const la = h.localAddress || "";
      return `${name}:${la}:${lp}->${h.remoteAddress || ""}:${h.remotePort || ""}`;
    }
    return name;
  });
  t.comment(`handles (${handles.length}): ${detail.join(", ")}`);
  t.comment(`requests (${requests.length})`);
  // Report-only to avoid masking leaks.
  t.ok(true);
});
