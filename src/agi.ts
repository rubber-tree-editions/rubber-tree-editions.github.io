
import bs from 'binary-search';
import { xxHash32 } from 'js-xxhash/dist/xxHash32';

export const AGI_FILENAME_PATTERN = /VOL\.[0-9]+$|[^\\\/]DIR$|(?:[^\\\/]|^)(?:OBJECT|WORDS\.TOK)$/i;

export interface AGIFolder {
  loadFile(filename: string): Promise<Uint8Array>;
  findFilenames(pattern: RegExp): Promise<string[]>;
}

export async function readAgiFolder(folder: AGIFolder) {
  let version: 2 | 3 | undefined = undefined;
  const dirFiles = await folder.findFilenames(/DIR$/i);
  if (dirFiles.length === 0) {
    return null;
  }
  let volFiles: string[];
  if (dirFiles.length === 1) {
    version = 3;
    const prefix = dirFiles[0].slice(0, -3);
    volFiles = await folder.findFilenames(new RegExp('^' + prefix + 'VOL\\.[0-9]+$'));
  }
  else {
    version = 2;
    volFiles = await folder.findFilenames(/^VOL\.[0-9]+$/);
  }
  const [ objectFile, wordFile ] = await Promise.all([
    folder.loadFile('OBJECT'),
    folder.loadFile('WORDS.TOK'),
  ]);
}

export type WordPatch = {type:'add', id:number, word:string} | {type:'delete', word:string};

export interface Token {
  word: string;
  id: number;
}

export function hashToken(token: Token) {
  return xxHash32(new Uint8Array([
    token.id >> 8, token.id & 0xff,
    ...[...token.word].map(v => v.charCodeAt(0) & 0xff)
  ]));
}

const tokenComp = (a: Token, b: Token) => (a.word < b.word) ? -1 : (a.word > b.word) ? 1 : 0;

export class WordsTok implements Iterable<Token> {
  constructor(src?: Iterable<Token>) {
    if (src) {
      this.words = [...src];
      if (!(src instanceof WordsTok)) {
        this.words.sort(tokenComp);
      }
    }
    else {
      this.words = [];
    }
  }
  static decode(data: Uint8Array): WordsTok {
    const dict = new WordsTok();
    let pos = 26 * 2;
    let prevWord = '';
    while (pos < data.length) {
      let word = prevWord.slice(0, data[pos++]);
      while (data[pos] !== 0x7F) {
        const charcode = data[pos++] ^ 0x7F;
        if (charcode >= 0x80) {
          word += String.fromCharCode(0xF700 | charcode);
        }
        else {
          word += String.fromCharCode(charcode);
        }
      }
      const id = (data[pos+1] * 0x100) + data[pos+2];
      pos += 3;
      dict.setWord(word, id);
      prevWord = word;
    }
    return dict;
  }
  private words: Token[];
  [Symbol.iterator]() {
    return this.words[Symbol.iterator]();
  }
  hasWord(word: string) {
    return bs(this.words, {word, id:0}, tokenComp) >= 0;
  }
  setWord(word: string, id: number) {
    const tok: Token = {word, id};
    const i = bs(this.words, tok, tokenComp);
    if (i < 0) {
      this.words.splice(~i, 0, tok);
    }
    else {
      this.words[i] = tok;
    }
  }
  deleteWord(word: string) {
    const i = bs(this.words, {word, id:0}, tokenComp);
    if (i >= 0) {
      this.words.splice(i, 1);
    }
  }
  getWordId(word: string): number | undefined {
    const i = bs(this.words, {word, id:0}, tokenComp);
    return (i < 0) ? undefined : this.words[i].id;
  }
  getUniqueIds(): number[] {
    return [...new Set<number>(this.words.map(({id}) => id))].sort((a, b) => a - b);
  }
  getWordsById(id: number): string[] {
    return this.words.filter(({ id: cmpId }) => id === cmpId).map(({ word }) => word);
  }
  calculateEncodedLength(): number {
    let len = 26 * 2;
    if (this.words.length > 0) {
      len += 1 + this.words[0].word.length + 1 + 2;
      for (let i = 1; i < this.words.length; i++) {
        len += 1 + this.words[i].word.length + 1 + 2;
        for (let j = 0; j < Math.min(this.words[i-1].word.length, this.words[i].word.length); j++) {
          if (this.words[i-1].word[j] !== this.words[i].word[j]) {
            break;
          }
          len--;
        }
      }
    }
    return len;
  }
  encode(): Uint8Array {
    const encoded = new Uint8Array(this.calculateEncodedLength());
    let pos = 26 * 2;
    if (this.words.length > 0) {
      const firstLetterPos = this.words[0].word.charCodeAt(0) - 'a'.charCodeAt(0);
      if (firstLetterPos >= 0 && firstLetterPos <= 26) {
        encoded[firstLetterPos*2] = (pos >> 8);
        encoded[firstLetterPos*2 + 1] = (pos & 0xff);
      }
      encoded[pos++] = 0;
      for (let char_i = 0; char_i < this.words[0].word.length; char_i++) {
        encoded[pos++] = this.words[0].word.charCodeAt(char_i) ^ 0x7f;
      }
      encoded[pos++] = 0x7f;
      encoded[pos++] = this.words[0].id & 0xff;
      encoded[pos++] = this.words[0].id >> 8;
      for (let word_i = 1; word_i < this.words.length; word_i++) {
        const letterPos = this.words[word_i].word.charCodeAt(0) - 'a'.charCodeAt(0);
        if (this.words[word_i].word[0] !== this.words[word_i-1].word[0] && letterPos >= 0 && letterPos <= 26) {
          encoded[letterPos*2] = (pos >> 8);
          encoded[letterPos*2 + 1] = pos & 0xff;
        }
        let char_i = 0;
        while (char_i < Math.min(this.words[word_i-1].word.length, this.words[word_i].word.length)
            && this.words[word_i-1].word[char_i] === this.words[word_i].word[char_i]) {
          char_i++;
        }
        encoded[pos++] = char_i;
        for (; char_i < this.words[word_i].word.length; char_i++) {
          encoded[pos++] = this.words[word_i].word.charCodeAt(char_i) ^ 0x7f;
        }
        encoded[pos++] = 0x7f;
        encoded[pos++] = this.words[word_i].id & 0xff;
        encoded[pos++] = this.words[word_i].id >> 8;
      }
    }
    return encoded;
  }
}

export interface Item {
  name: string;
  roomNumber: number;  
}

export function hashItem(item: Item) {
  return xxHash32(new Uint8Array([
    item.roomNumber,
    ...[...item.name].map(v => v.charCodeAt(0) & 0xff)
  ]));
}

export const STANDARD_XOR_PATTERN = new Uint8Array([...'Avis Durgan'].map(v => v.charCodeAt(0)));

function readObjectRecords(bytes: Uint8Array, recordAlignment: number): Item[] {
  let dataStartPos = Infinity;
  let pos = 0;
  const records: Item[] = [];
  while (pos < dataStartPos) {
    let offset = recordAlignment + (bytes[pos] | (bytes[pos + 1] << 8));
    if (offset < (pos + recordAlignment) || offset >= bytes.length) {
      throw new Error('invalid offset');
    }
    dataStartPos = Math.min(dataStartPos, recordAlignment + offset);
    let name = '';
    while (bytes[offset]) {
      const c = bytes[offset++];
      name += String.fromCharCode(c >= 0x80 ? 0xf700 | c : c);
    }
    if (offset === bytes.length) {
      throw new Error('unterminated string');
    }
    records.push({name, roomNumber: bytes[pos + 2]});
    pos += recordAlignment;
  }
  if (pos > dataStartPos) {
    throw new Error('invalid offset');
  }
  return records;
}

export class InventoryFile {
  static decode(bytes: Uint8Array): InventoryFile {
    const objects = new InventoryFile();
    if (bytes[bytes.length - 1] !== 0x00) {
      bytes = new Uint8Array(bytes);
      const xorPattern = STANDARD_XOR_PATTERN;
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] ^= xorPattern[i % xorPattern.length];
      }
      objects.xorPattern = xorPattern;
    }
    let records: Item[];
    try {
      records = readObjectRecords(bytes, 3);
      objects.recordAlignment = 3;
    }
    catch {
      records = readObjectRecords(bytes, 4);
      objects.recordAlignment = 4;
    }
    objects.maxAnimatedObjects = records[0].roomNumber;
    objects.nullItemName = records[0].name;
    objects.items = records.slice(1);
    return objects;
  }
  public maxAnimatedObjects = 17;
  public recordAlignment = 3;
  public items = new Array<Item>();
  public xorPattern: Uint8Array | null = null;
  public nullItemName = '?';
  calculateEncodedLength() {
    return this.items.reduce(
      (len, it) => len + it.name.length + 1,
      this.recordAlignment * (1 + this.items.length));
  }
  encode(): Uint8Array {
    const data = new Uint8Array(this.calculateEncodedLength());
    let textPos = this.recordAlignment * (1 + this.items.length);
    data[0] = (textPos - this.recordAlignment) & 0xff;
    data[1] = (textPos - this.recordAlignment) >> 8;
    data[2] = this.maxAnimatedObjects;
    for (let i = 0; i < this.nullItemName.length; i++) {
      data[textPos++] = this.nullItemName.charCodeAt(i) & 0xff;
    }
    data[textPos++] = 0;
    let ptrPos = this.recordAlignment;
    for (const { name, roomNumber } of this.items) {
      data[ptrPos++] = (textPos - this.recordAlignment) & 0xff;
      data[ptrPos++] = (textPos - this.recordAlignment) >> 8;
      data[ptrPos++] = roomNumber;
      ptrPos += this.recordAlignment;
      for (let i = 0; i < name.length; i++) {
        data[textPos++] = name.charCodeAt(i) & 0xff;
      }
      data[textPos++] = 0;
    }
    if (this.xorPattern) {
      for (let i = 0; i < data.length; i++) {
        data[i] ^= this.xorPattern[i % this.xorPattern.length];
      }
    }
    return data;
  }
}

export interface LogicPatch {
  startHash: number;
  endHash: number;
  operations: LogicPatchOp[];
}

export type LogicPatchOp = (
  {type:'delete', smart: boolean, offset: number, length: number}
  | {type:'insert', smart: boolean, offset: number, payload: Uint8Array}
  | {type:'xor', offset:number, payload: Uint8Array}
);

export function applyLogicPatches(logic: Uint8Array, patches: LogicPatchOp[]) {
  const newLogic = new Uint8Array(patches.reduce(
    (len, patch) => len + (patch.type === 'insert' ? patch.payload.length : 0),
    logic.length));
  newLogic.set(logic);
  let logicLen = logic.length;
  for (const patch of patches) {
    switch (patch.type) {
      case 'delete': {
        newLogic.copyWithin(patch.offset, patch.offset + patch.length, logicLen);
        logicLen -= patch.length;
        break;
      }
      case 'insert': {
        newLogic.copyWithin(patch.offset + patch.payload.length, patch.offset, logicLen);
        logicLen += patch.payload.length;
        newLogic.set(patch.payload, patch.offset);
        break;
      }
      case 'xor': {
        for (let i = 0; i < patch.payload.length; i++) {
          newLogic[patch.offset + i] ^= patch.payload[i];
        }
        break;
      }
    }
  }
  return newLogic.subarray(0, logicLen);
}
