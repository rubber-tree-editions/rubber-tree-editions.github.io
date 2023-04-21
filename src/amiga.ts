
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

function crc16_ansi(bytes: Uint8Array) {
  let crc = 0;
  for (let byte_i = 0; byte_i < bytes.length; byte_i++) {
    crc ^= bytes[byte_i];
    for (let bit_i = 0; bit_i < 8; bit_i++) {
      const carry = crc & 1;
      crc >>>= 1;
      if (carry) {
        crc ^= 0xA001;
      }
    }
  }
  return crc;
}

abstract class LZHEntry {
  constructor(readonly header: Uint8Array, readonly extendedHeaders: Uint8Array[], readonly payload: Uint8Array) {
  }
  readonly headerDV = new DataView(this.header.buffer, this.header.byteOffset, this.header.byteLength);
  get level() { return this.header[20]; }
  get packedSize() { return this.headerDV.getUint32(7, true); }
  get unpackedSize() { return this.headerDV.getUint32(11, true); }
  get method() {
    const nameBytes = this.header.subarray(2, 7);
    return String.fromCharCode.apply(String, [...nameBytes].map(v => (v < 0x80) ? v : v | 0xf700));
  }
  getExtendedHeader(id: number): Uint8Array | undefined {
    return this.extendedHeaders.filter(v => v[0] === id)[0];
  }
  get name() {
    const dirNameBytes = this.getExtendedHeader(2);
    const fileNameBytes = this.getExtendedHeader(1);
    const pathParts: string[] = [];
    if (dirNameBytes) {
      const parentPath = String.fromCharCode.apply(String, [...dirNameBytes.subarray(1)].map(v => v < 0x80 ? v : 0xf700 | v));
      if (parentPath.length > 0) {
        pathParts.push(...parentPath.split(/\uF7FF/g));
      }
    }
    if (fileNameBytes) {
      const filename = String.fromCharCode.apply(String, [...fileNameBytes.subarray(1)].map(v => v < 0x80 ? v : 0xf700 | v));
      if (filename.length > 0) {
        pathParts.push(filename);
      }
    }
    return pathParts.join('/');
  }
  get headerCrc16() {
    const bytes = this.getExtendedHeader(0);
    return bytes && bytes.length > 3 ? bytes[1] | (bytes[2] << 16) : undefined;
  }
  readonly abstract unpackedCrc16: number;
  calcPayloadCrc16() {
    return crc16_ansi(this.payload);
  }
  static LEVELS: Array<{new(header: Uint8Array, extendedHeaders: Uint8Array[], payload: Uint8Array): LZHEntry}> = [
    class LZHEntryL0 extends LZHEntry {
      get name() {
        const nameBytes = this.header.subarray(22, 22 + this.header[21]);
        return String.fromCharCode.apply(String, [...nameBytes].map(v => (v < 0x80) ? v : v | 0xf700));
      }
      get unpackedCrc16() {
        return this.headerDV.getUint16(22 + this.header[21], true);
      }
    },
    class LZHEntryL1 extends LZHEntry {
      get packedSize() { return this.headerDV.getUint32(7, true) - this.extendedHeaders.reduce((len, h) => len + h.byteLength, 0); }
      get name() {
        const nameBytes = this.header.subarray(22, 22 + this.header[21]);
        return String.fromCharCode.apply(String, [...nameBytes].map(v => (v < 0x80) ? v : v | 0xf700));
      }
      get unpackedCrc16() {
        return this.headerDV.getUint16(22 + this.header[21], true);
      }
    },
    class LZHEntryL2 extends LZHEntry {
      get unpackedCrc16() {
        return this.headerDV.getUint16(21, true);
      }
    },
    class LZHEntryL3 extends LZHEntry {
      get unpackedCrc16() {
        return this.headerDV.getUint16(21, true);
      }
    },
  ];
}

export function readLZHEntry(bytes: Uint8Array, offset: number) {
  const level = bytes[offset + 20];
  let headerLength: number;
  if (level < 2) {
    headerLength = 2 + bytes[offset];
  }
  else if (level === 2) {
    headerLength = bytes[offset] | (bytes[offset + 1] << 8);
  }
  else if (level === 3) {
    headerLength = 31;
  }
  else {
    return null;
  }
  const baseHeader = bytes.subarray(offset, offset + headerLength);
  let packedSize = (bytes[offset + 7] | (bytes[offset + 8] << 8) | (bytes[offset + 9] << 16) | (bytes[offset + 10] << 24)) >>> 0;
  const extendedHeaders: Uint8Array[] = [];
  let ptr = offset + headerLength;
  if (level === 3) {
    let extendedHeaderLength = (baseHeader[baseHeader.length - 4] | (baseHeader[baseHeader.length - 3] << 8) | (baseHeader[baseHeader.length - 2] << 16) | (baseHeader[baseHeader.length - 1] << 24)) >>> 0;
    while (extendedHeaderLength > 0) {
      const extHeader = bytes.subarray(ptr, ptr + extendedHeaderLength);
      extendedHeaders.push(extHeader);
      ptr += extendedHeaderLength;
      extendedHeaderLength = (extHeader[extHeader.length - 4] | (extHeader[extHeader.length - 3] << 8) | (extHeader[extHeader.length - 2] << 16) | (extHeader[extHeader.length - 1] << 24)) >>> 0;
    }
  }
  else if (level > 0) {
    let extendedHeaderLength = baseHeader[baseHeader.length - 2] | (baseHeader[baseHeader.length - 1] << 8);
    while (extendedHeaderLength > 0) {
      const extHeader = bytes.subarray(ptr, ptr + extendedHeaderLength);
      extendedHeaders.push(extHeader);
      ptr += extendedHeaderLength;
      if (level === 1) packedSize -= extendedHeaderLength;
      extendedHeaderLength = extHeader[extHeader.length - 2] | (extHeader[extHeader.length - 1] << 8);
    }
  }
  const payload = new Uint8Array(bytes.buffer, bytes.byteOffset + ptr, packedSize);
  ptr += packedSize;
  return {
    entry: new LZHEntry.LEVELS[level](
      baseHeader,
      extendedHeaders,
      payload,
    ),
    endOffset: ptr,
  };
}
