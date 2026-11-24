const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyExecutable(file, machines) {
  const descriptor = await fs.open(file);
  try {
    const header = Buffer.alloc(64);
    const dos = await descriptor.read(header, 0, header.length, 0);
    if (
      dos.bytesRead !== header.length ||
      header.toString("ascii", 0, 2) !== "MZ"
    ) {
      throw new Error(`Missing DOS header in ${file}`);
    }
    const signature = Buffer.alloc(6);
    const pe = await descriptor.read(
      signature,
      0,
      signature.length,
      header.readUInt32LE(60)
    );
    if (
      pe.bytesRead !== signature.length ||
      signature.readUInt32LE() !== 0x4550
    ) {
      throw new Error(`Missing PE signature in ${file}`);
    }
    if (!machines.includes(signature.readUInt16LE(4))) {
      throw new Error(`Unexpected PE machine in ${file}`);
    }
  } finally {
    await descriptor.close();
  }
}

async function main() {
  if (process.platform !== "win32")
    throw new Error("The packaging check requires Windows");
  const version = process.env.KRYSTA_VERSION;
  const { name, version: packageVersion } = require("../package.json");
  if (name !== "krysta-launcher" || !version || packageVersion !== version) {
    throw new Error(
      "The build package does not match the expected Krysta version"
    );
  }

  const addon = path.resolve(
    "dist",
    "win-unpacked",
    "resources",
    "hydra-native",
    "hydra-native.node"
  );
  const x64 = 0x8664;
  const x86 = 0x014c;
  await verifyExecutable(path.join("dist", "win-unpacked", "Krysta.exe"), [
    x64,
  ]);
  await verifyExecutable(addon, [x64]);
  if (
    (await sha256(addon)) !== (await sha256("hydra-native/hydra-native.node"))
  ) {
    throw new Error(
      "The packaged native addon does not match the compiled addon"
    );
  }
  execFileSync(
    require("electron"),
    [
      "-e",
      `const { strictEqual } = require("node:assert");
      const addon = require(process.argv[1]);
      for (const name of process.argv.slice(2)) {
        strictEqual(typeof addon[name], "function", "Missing native export: " + name);
      }`,
      addon,
      "moveWindowsControllerCursor",
      "windowsControllerDesktopAction",
      "getWindowsSonyHidBatteries",
      "pollWindowsDesktopControllers",
      "stopWindowsDesktopControllerInput",
      "listWindowsDesktopControllers",
      "getWindowsDesktopEditableFocus",
      "showWindowsDesktopKeyboard",
      "getWindowsControllerDisplays",
      "getWindowsControllerDisplayMode",
      "switchWindowsControllerDisplay",
      "restoreWindowsControllerDisplay",
      "getWindowsControllerAudioDefaults",
      "switchWindowsControllerHdmiAudio",
      "restoreWindowsControllerAudioDefaults",
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
      timeout: 30_000,
      windowsHide: true,
    }
  );

  const stem = `${name}-${version}`;
  const checksums = [];
  for (const suffix of ["setup", "portable"]) {
    const filename = `${stem}-${suffix}.exe`;
    const file = path.join("dist", filename);
    // NSIS wrappers use x86 even when they carry a 64-bit application.
    await verifyExecutable(file, [x86, x64]);
    checksums.push(`${await sha256(file)}  ${filename}`);
  }
  await fs.writeFile(
    path.join("dist", `${stem}-sha256.txt`),
    checksums.join("\n") + "\n"
  );
  console.log(
    "Verified the packaged Windows controller module and both executables."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
