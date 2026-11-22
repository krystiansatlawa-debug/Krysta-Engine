import type { AutomaticGameStoryProgress } from "@types";

export const farCry4SaveLimit = 4 * 1024 * 1024;
const binaryHeader = Buffer.from([0x6e, 0x62, 0x43, 0x46, 2, 0, 0, 0]);
const worldState = 0x586818e3;
// This Dunia object path leads to the saved campaign flags in PC saves.
const campaignFlags = [
  worldState,
  0x7e51e3e7,
  0xc3205e95,
  0xe8de2d18,
  0xdc8f68cb,
  0xe8d4929f,
  0x25ee66e6,
  0x8ede36e7,
];
const flagNameField = 0x3f3ba283;
const flagValueField = 0xee6a8fdf;

export function parseFarCry4StorySave(
  bytes: Buffer
): Omit<AutomaticGameStoryProgress, "savedAt"> | null {
  if (bytes.length > farCry4SaveLimit) return null;
  const start = bytes.indexOf(binaryHeader);
  if (start < 0 || bytes.length - start < 22) return null;
  const objectCount = bytes.readUInt32LE(start + 8);
  if (objectCount === 0 || objectCount > 100_000) return null;

  let cursor = start + 16;
  let objectsRead = 0;
  const nodes: number[] = [];
  const missionFlags = new Map<string, boolean>();
  let campaignFound = false;

  const readWord = () => {
    const word = bytes.readUInt32LE(cursor);
    cursor += 4;
    return word;
  };
  const readCount = () => {
    const tag = bytes.readUInt8(cursor++);
    return { value: tag < 254 ? tag : readWord(), reference: tag === 254 };
  };
  const readField = () => {
    const fieldStart = cursor;
    const count = readCount();
    const next = cursor;
    if (count.reference) {
      cursor = fieldStart - count.value;
      if (cursor < start + 16 || cursor >= fieldStart)
        throw new Error("Invalid field reference");
    }
    const size = count.reference ? readCount() : count;
    const end = cursor + size.value;
    if (
      size.reference ||
      end > bytes.length ||
      (count.reference && end > fieldStart)
    )
      throw new Error("Invalid field length");
    const field = bytes.subarray(cursor, end);
    cursor = count.reference ? next : end;
    return field;
  };

  const readNode = () => {
    const children = readCount();
    if (children.reference) {
      if (children.value >= objectsRead)
        throw new Error("Invalid node reference");
      return;
    }
    if (++objectsRead > objectCount || nodes.length > 64)
      throw new Error("Invalid tree size");
    const node = readWord();
    if (nodes.length === 0 && node !== worldState)
      throw new Error("Unexpected save root");
    const flag =
      node === 0x8ede36e7 &&
      nodes.length === campaignFlags.length &&
      nodes.every((parent, index) => parent === campaignFlags[index]);
    const fields = readCount();
    if (fields.reference || fields.value > (bytes.length - cursor) / 5)
      throw new Error("Invalid field count");
    let name: Buffer | undefined;
    let value: Buffer | undefined;
    for (let index = 0; index < fields.value; index++) {
      const key = readWord();
      const data = readField();
      if (flag && key === flagNameField) name = data;
      if (flag && key === flagValueField) value = data;
    }
    if (flag && name?.at(-1) === 0 && value?.length === 1 && value[0] <= 1) {
      const variable = name.subarray(0, -1).toString("latin1");
      const mission = /^mis_(\d{3})_debriefdone$/.exec(variable)?.[1];
      if (variable === "mis_010_alternativeending" || mission)
        campaignFound = true;
      if (mission) {
        const done = value[0] === 1;
        if (missionFlags.has(mission) && missionFlags.get(mission) !== done)
          throw new Error("Conflicting mission flags");
        missionFlags.set(mission, done);
      }
    }
    if (children.value > bytes.length - cursor)
      throw new Error("Invalid node count");
    nodes.push(node);
    for (let index = 0; index < children.value; index++) readNode();
    nodes.pop();
  };

  try {
    readNode();
  } catch {
    return null;
  }
  if (!campaignFound || objectsRead !== objectCount) return null;
  const completedMissions = [...missionFlags.values()].filter(Boolean).length;
  return { percent: null, saveTitle: "", completedMissions };
}
