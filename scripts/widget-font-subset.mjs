// TrueType glyf/loca subset, using the audit's retain-GID algorithm. No external
// executable or package: Node buffers are the only tooling needed in CI/offline.
// Tables, cmap and metrics stay byte-identical; removed glyph slots become empty.
// Composite components are retained transitively, without renumbering any glyph.
import assert from 'node:assert/strict';

export function readTrueType(data) {
  assert.equal(data.readUInt32BE(0), 0x00010000, 'widget font must be glyf TrueType');
  const tables = new Map();
  const count = data.readUInt16BE(4);
  for(let index = 0; index < count; ++index) {
    const offset = 12 + index * 16;
    const start = data.readUInt32BE(offset + 8), length = data.readUInt32BE(offset + 12);
    assert(start + length <= data.length, 'invalid TrueType table bounds');
    tables.set(data.toString('ascii', offset, offset + 4), data.subarray(start, start + length));
  }
  assert.equal(tables.size, count, 'duplicate TrueType tables');
  const cmap = tables.get('cmap'), mapping = new Map();
  for(let index = 0; index < cmap.readUInt16BE(2); ++index) {
    const offset = cmap.readUInt32BE(8 + index * 8);
    const format = cmap.readUInt16BE(offset);
    // The upstream icon font has Unicode BMP format 4 maps only. Fail closed
    // rather than dropping a future non-BMP font's glyphs.
    assert.equal(format, 4, 're-review widget font cmap format');
    const map = cmap.subarray(offset), segments = map.readUInt16BE(6) / 2;
    const endAt = 14, startAt = endAt + segments * 2 + 2;
    const deltaAt = startAt + segments * 2, rangeAt = deltaAt + segments * 2;
    for(let segment = 0; segment < segments; ++segment) {
      const end = map.readUInt16BE(endAt + segment * 2), start = map.readUInt16BE(startAt + segment * 2);
      const delta = map.readUInt16BE(deltaAt + segment * 2), range = map.readUInt16BE(rangeAt + segment * 2);
      for(let code = start; code <= end; ++code) {
        let glyph = range ? map.readUInt16BE(rangeAt + segment * 2 + range + (code - start) * 2) : (code + delta) & 0xffff;
        if(range && glyph) glyph = (glyph + delta) & 0xffff;
        if(mapping.has(code)) assert.equal(mapping.get(code), glyph, 'inconsistent TrueType cmaps');
        mapping.set(code, glyph);
      }
    }
  }
  const glyphCount = tables.get('maxp').readUInt16BE(4), format = tables.get('head').readInt16BE(50);
  assert(format === 0 || format === 1, 'invalid TrueType loca format');
  for(const glyph of mapping.values()) assert(glyph < glyphCount, 'invalid cmap glyph ID');
  const loca = tables.get('loca'), glyf = tables.get('glyf');
  const offsets = Array.from({length: glyphCount + 1}, (_, index) => format ? loca.readUInt32BE(index * 4) : loca.readUInt16BE(index * 2) * 2);
  for(let index = 0; index < glyphCount; ++index) assert(offsets[index] <= offsets[index + 1] && offsets[index + 1] <= glyf.length, 'invalid TrueType glyph bounds');
  return {tables, mapping, offsets, format, glyphCount, glyph: id => glyf.subarray(offsets[id], offsets[id + 1])};
}

export function fontChecksum(buffer) {
  let result = 0;
  for(let offset = 0; offset < buffer.length; offset += 4) {
    let word = 0;
    for(let byte = 0; byte < 4; ++byte) word = (word << 8) | (buffer[offset + byte] || 0);
    result = (result + (word >>> 0)) >>> 0;
  }
  return result;
}

export function subsetWidgetFont(data, codes) {
  const font = readTrueType(data), keep = new Set([0]);
  for(const code of codes) {
    const glyph = font.mapping.get(code);
    assert(glyph && font.glyph(glyph).length, `widget icon missing from upstream font: U+${code.toString(16)}`);
    keep.add(glyph);
  }
  const queue = [...keep];
  while(queue.length) {
    const glyph = font.glyph(queue.pop());
    if(!glyph.length || glyph.readInt16BE(0) >= 0) continue;
    let offset = 10, flags;
    do {
      flags = glyph.readUInt16BE(offset);
      const component = glyph.readUInt16BE(offset + 2);
      assert(component < font.glyphCount, 'invalid composite glyph');
      if(!keep.has(component)) { keep.add(component); queue.push(component); }
      offset += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 64 ? 4 : flags & 128 ? 8 : 0);
    } while(flags & 32);
  }
  const offsets = [], pieces = [];
  let length = 0;
  for(let id = 0; id < font.glyphCount; ++id) {
    offsets.push(length);
    if(!keep.has(id)) continue;
    const glyph = font.glyph(id);
    pieces.push(glyph);
    length += glyph.length;
    if(length % 2) { pieces.push(Buffer.alloc(1)); ++length; }
  }
  offsets.push(length);
  const loca = Buffer.alloc(offsets.length * (font.format ? 4 : 2));
  offsets.forEach((offset, index) => {
    if(font.format) loca.writeUInt32BE(offset, index * 4);
    else loca.writeUInt16BE(offset / 2, index * 2);
  });
  const tables = new Map(font.tables);
  tables.set('glyf', Buffer.concat(pieces));
  tables.set('loca', loca);
  const head = Buffer.from(tables.get('head'));
  head.writeUInt32BE(0, 8);
  tables.set('head', head);
  const directory = Buffer.alloc(12 + tables.size * 16);
  data.copy(directory, 0, 0, 12);
  const output = [directory];
  let offset = directory.length, headOffset;
  [...tables.keys()].sort().forEach((tag, index) => {
    const table = tables.get(tag), entry = 12 + index * 16;
    directory.write(tag, entry, 4, 'ascii');
    directory.writeUInt32BE(fontChecksum(table), entry + 4);
    directory.writeUInt32BE(offset, entry + 8);
    directory.writeUInt32BE(table.length, entry + 12);
    if(tag === 'head') headOffset = offset;
    const padding = (4 - table.length % 4) % 4;
    output.push(table, Buffer.alloc(padding));
    offset += table.length + padding;
  });
  const result = Buffer.concat(output);
  result.writeUInt32BE((0xb1b0afba - fontChecksum(result)) >>> 0, headOffset + 8);
  // Validate the output contract, including composite closure and stable IDs.
  assert.equal(fontChecksum(result), 0xb1b0afba);
  const subset = readTrueType(result);
  assert.deepEqual(subset.mapping, font.mapping);
  assert.equal(subset.glyphCount, font.glyphCount);
  for(const id of keep) assert.deepEqual(subset.glyph(id), font.glyph(id));
  return result;
}
