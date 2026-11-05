/**
 * Unzip a web OTA bundle into a directory. No checksum: the installed
 * shell does not hash the zip. Entries that escape the destination are rejected.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function isHttpsDownloadUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function findEocd(view) {
  const min = Math.max(0, view.length - 0xffff - 22);
  for (let i = view.length - 22; i >= min; i--) {
    if (view.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("zip 목차를 찾지 못했습니다.");
}

function safeEntryPath(destDir, name) {
  const normalized = String(name || "").replace(/\\/g, "/");
  if (!normalized || normalized.endsWith("/")) return null;
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("zip 경로가 대상 폴더 밖을 가리킵니다.");
  }
  const outPath = path.resolve(destDir, ...normalized.split("/"));
  const root = path.resolve(destDir);
  if (outPath !== root && !outPath.startsWith(root + path.sep)) {
    throw new Error("zip 경로가 대상 폴더 밖을 가리킵니다.");
  }
  return outPath;
}

function unzipBuffer(buffer, destDir) {
  const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (view.length < 22) throw new Error("zip 파일이 너무 작습니다.");
  fs.mkdirSync(destDir, { recursive: true });
  const eocd = findEocd(view);
  const cdOffset = view.readUInt32LE(eocd + 16);
  const entryCount = view.readUInt16LE(eocd + 10);
  let cursor = cdOffset;
  for (let n = 0; n < entryCount; n++) {
    if (cursor + 46 > view.length || view.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("zip 목차가 손상되었습니다.");
    }
    const method = view.readUInt16LE(cursor + 10);
    const compSize = view.readUInt32LE(cursor + 20);
    const nameLen = view.readUInt16LE(cursor + 28);
    const extraLen = view.readUInt16LE(cursor + 30);
    const commentLen = view.readUInt16LE(cursor + 32);
    const localOffset = view.readUInt32LE(cursor + 42);
    const name = view.slice(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    cursor += 46 + nameLen + extraLen + commentLen;

    const outPath = safeEntryPath(destDir, name);
    if (!outPath) continue;
    if (view.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("zip 항목을 찾지 못했습니다.");
    }
    const localNameLen = view.readUInt16LE(localOffset + 26);
    const localExtraLen = view.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = view.slice(dataStart, dataStart + compSize);
    let content;
    if (method === 0) content = data;
    else if (method === 8) content = zlib.inflateRawSync(data);
    else throw new Error("지원하지 않는 zip 압축입니다.");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
  }
}

module.exports = { isHttpsDownloadUrl, unzipBuffer };
