
const ADF_BLOCK_SIZE = 512;

enum Type {
  HEADER = 2,
  DATA = 8,
  DIR_CACHE = 33,
  FILE_EXTENSION = 16,
}

enum SecondaryType {
  ROOT = 1,
  USERDIR = 2,
  SOFTLINK = 3,
  FILE = -3,
  LINKFILE = 4,
  LINKDIR = -4,
}

function readADFDate(dv: DataView, offset: number) {
  return new Date(
    new Date(1978, 1, 1).getTime()
    + dv.getUint32(offset, false) * 1000*60*60*24
    + dv.getUint32(offset+4, false) * 1000*60
    + dv.getUint32(offset+8, false) * 20);
}

function writeADFDate(dv: DataView, offset: number, date: Date) {
  let ms = date.getTime() - new Date(1978, 1, 1).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  ms -= days * 1000 * 60 * 60 * 24;
  const minutes = Math.floor(ms / (1000 * 60));
  ms -= minutes * 1000 * 60;
  const ticks = Math.floor(ms / 20);
  dv.setUint32(offset, days, false);
  dv.setUint32(offset, minutes, false);
  dv.setUint32(offset, ticks, false);
}

function verifyRootBlock(rootBlockDV: DataView) {
  // first, check the block is a HEADER/ROOT
  if (rootBlockDV.getUint32(0, false) !== Type.HEADER) return null;
  if (rootBlockDV.getUint32(rootBlockDV.byteLength - 4, false) !== SecondaryType.ROOT) return null;
  // second, make sure the checksum is valid
  let checksum = 0;
  for (let i = 0; i < rootBlockDV.byteLength/4; i++) {
    if (i === 5) continue;
    checksum = (checksum + rootBlockDV.getUint32(i * 4, false)) | 0;
  }
  checksum = -checksum;
  if (checksum !== rootBlockDV.getInt32(20, false)) {
    return null;
  }
  // the root block is now presumed valid.
  return {
    rootLastModifiedAt: readADFDate(rootBlockDV, rootBlockDV.byteLength - 92),
    diskLastModifiedAt: readADFDate(rootBlockDV, rootBlockDV.byteLength - 40),
    formattedAt: readADFDate(rootBlockDV, rootBlockDV.byteLength - 28),
  };
}

export function getADFStructure(data: Uint8Array) {
  if (data.length%ADF_BLOCK_SIZE !== 0) return null;
  const blockCount = data.length/ADF_BLOCK_SIZE;
  const rootBlockOffset = Math.floor(blockCount/2);
  const rootBlockDV = new DataView(
    data.buffer,
    data.byteOffset + rootBlockOffset * ADF_BLOCK_SIZE,
    ADF_BLOCK_SIZE);
  const rootBlock = verifyRootBlock(rootBlockDV);
  if (rootBlock == null) return null;
}

abstract class LZHEntry {
  constructor(readonly header: Uint8Array, readonly payload: Uint8Array) {
  }
  readonly headerDV = new DataView(this.header);
  get level() { return this.header[5]; }
  get packedSize() { return this.headerDV.getUint32(7, true); }
  get originalSize() { return this.headerDV.getUint32(11, true); }
  get method() {
    const nameBytes = this.header.subarray(2, 7);
    return String.fromCharCode.apply(String, [...nameBytes].map(v => (v < 0x80) ? v : v | 0xf700));
  }
  static LEVELS: Array<{new(header: Uint8Array, payload: Uint8Array): LZHEntry}> = [
    class LZHEntryL0 extends LZHEntry {
      get name() {
        const nameBytes = this.header.subarray(22, 22 + this.header[21]);
        return String.fromCharCode.apply(String, [...nameBytes].map(v => (v < 0x80) ? v : v | 0xf700));
      }
      get crc16() {
        return this.headerDV.getUint16(22 + this.header[21], true);
      }
    },
    class LZHEntryL1 extends LZHEntry {
      
    },
    class LZHEntryL2 extends LZHEntry {

    },
    class LZHEntryL3 extends LZHEntry {

    },
  ];
}

function readLZHEntry(bytes: Uint8Array, offset: number) {
  const level = bytes[offset + 5];
  let headerLength: number;
  if (level < 2) {
    headerLength = 2 + bytes[offset];
  }
  else if (level === 2) {
    headerLength = bytes[offset] | (bytes[offset + 1] << 8);
  }
  else if (level === 3) {
    headerLength = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24);
  }
  else {
    return null;
  }
  const packedSize = bytes[7] | (bytes[8] << 8) | (bytes[9] << 16) | (bytes[10] << 24);
  return {
    entry: new LZHEntry.LEVELS[level](
      bytes.subarray(offset, offset + headerLength),
      bytes.subarray(offset + headerLength, offset + headerLength + packedSize),
    ),
    endOffset: offset + headerLength + packedSize,
  };
}
