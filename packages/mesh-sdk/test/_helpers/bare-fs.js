import * as bareFs from "bare-fs";

async function makeRunDirs(prefix = "mesh-sdk-bare") {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const baseDir = `/tmp/${prefix}-${suffix}`;
  const hostStoreDir = `${baseDir}/host-store`;
  const clientStoreDir = `${baseDir}/client-store`;

  await bareFs.promises.mkdir(hostStoreDir, { recursive: true });
  await bareFs.promises.mkdir(clientStoreDir, { recursive: true });

  return { baseDir, hostStoreDir, clientStoreDir };
}

async function cleanupDir(dirPath) {
  if (!dirPath) return;
  await bareFs.promises.rm(dirPath, { recursive: true, force: true }).catch(() => {});
}

export { makeRunDirs, cleanupDir };
