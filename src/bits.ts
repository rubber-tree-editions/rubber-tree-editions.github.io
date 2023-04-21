
abstract class BitStream {
  protected data: Uint8Array;
  protected bitOffset: number;

  constructor(data: Uint8Array) {
    this.data = data;
    this.bitOffset = 0;
  }

  abstract readUnsignedBits(n: number): number;

  readSignedBits(n: number): number {
    let value = this.readUnsignedBits(n);
    if (value & (1 << (n - 1))) {
      // If the most significant bit is 1, it's a negative number
      value -= (1 << n);
    }
    return value;
  }
}

export class TopDownBitReader extends BitStream {
  readUnsignedBits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      let bit = (this.data[Math.floor(this.bitOffset / 8)] >> (7 - (this.bitOffset % 8))) & 1;
      this.bitOffset++;
      value = (value << 1) | bit;
    }
    return value;
  }
}

export class BottomUpBitReader extends BitStream {
  readUnsignedBits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      let bit = (this.data[Math.floor(this.bitOffset / 8)] >> (this.bitOffset % 8)) & 1;
      this.bitOffset++;
      value = (value << 1) | bit;
    }
    return value;
  }
}
