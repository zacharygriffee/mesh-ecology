import fs from "fs";
import os from "os";
import path from "path";

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkTemp(prefix) {
  const dir = mkTmp(prefix);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export { mkTmp, mkTemp };
