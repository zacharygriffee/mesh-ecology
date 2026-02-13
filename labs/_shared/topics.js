import crypto from "crypto";
import b4a from "b4a";

function topicFor(name) {
  const hash = crypto.createHash("sha256").update(name).digest();
  return b4a.from(hash.subarray(0, 32));
}

export { topicFor };
