const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

// Official standalone console build from the pinned MIT-licensed release.
const artifact = Object.freeze({
  version: "2.3.1",
  url: "https://github.com/GameTechDev/PresentMon/releases/download/v2.3.1/PresentMon-2.3.1-x64.exe",
  sha256: "364e5d98d4d134bd54dd25c22ed2ca2f4883f8bc3ed6502bee0c151e3436d30c",
  size: 421312,
});

function verify(bytes) {
  return (
    bytes.length === artifact.size &&
    createHash("sha256").update(bytes).digest("hex") === artifact.sha256
  );
}

async function cached(file) {
  try {
    const st = await fs.lstat(file);
    return (
      st.isFile() &&
      st.size === artifact.size &&
      verify(await fs.readFile(file))
    );
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function preparePresentMon({
  projectDir = path.resolve(__dirname, ".."),
} = {}) {
  const directory = path.join(projectDir, ".cache", "presentmon");
  const file = path.join(directory, "PresentMon.exe");
  if (await cached(file)) return file;
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, randomUUID() + ".download");
  try {
    const response = await fetch(artifact.url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body)
      throw new Error("PresentMon download failed: HTTP " + response.status);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > artifact.size)
          throw new Error("PresentMon size mismatch");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    if (!verify(bytes)) throw new Error("PresentMon SHA-256 or size mismatch");
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    try {
      await fs.rename(temporary, file);
    } catch (error) {
      if (!(await cached(file))) throw error;
    }
    console.log("Verified PresentMon " + artifact.version + " (x64).");
    return file;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

module.exports = { preparePresentMon };

if (require.main === module) {
  preparePresentMon().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
