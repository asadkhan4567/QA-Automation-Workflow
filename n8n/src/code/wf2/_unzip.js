// Minimal ZIP reader + RFC1951 inflate in pure JS (n8n Cloud blocks the zlib module in Code nodes).
function inflateRaw(src) {
  const out = []; let pos = 0, bitBuf = 0, bitCnt = 0;
  const bits = (n) => { while (bitCnt < n) { if (pos >= src.length) throw new Error('inflate: unexpected end'); bitBuf |= src[pos++] << bitCnt; bitCnt += 8; } const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v; };
  const build = (lens) => { const count = new Array(16).fill(0); lens.forEach((l) => count[l]++); count[0] = 0; const offs = [0]; for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1]; const sym = []; lens.forEach((l, s) => { if (l) sym[offs[l]++] = s; }); return { count, sym }; };
  const decode = (h) => { let code = 0, first = 0, idx = 0; for (let len = 1; len < 16; len++) { code |= bits(1); const c = h.count[len]; if (code - c < first) return h.sym[idx + (code - first)]; idx += c; first += c; first <<= 1; code <<= 1; } throw new Error('inflate: bad code'); };
  const LB = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258], LE = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const DB = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577], DE = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  let fixedL, fixedD;
  let final = 0;
  while (!final) {
    final = bits(1); const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0; const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      for (let i = 0; i < len; i++) out.push(src[pos++]);
      continue;
    }
    let lit, dist;
    if (type === 1) {
      if (!fixedL) { const l = []; for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8; fixedL = build(l); fixedD = build(new Array(30).fill(5)); }
      lit = fixedL; dist = fixedD;
    } else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const ord = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]; const cl = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) cl[ord[i]] = bits(3);
      const ch = build(cl); const lens = [];
      while (lens.length < hlit + hdist) {
        const s = decode(ch);
        if (s < 16) lens.push(s);
        else if (s === 16) { const prev = lens[lens.length - 1]; for (let r = 3 + bits(2); r > 0; r--) lens.push(prev); }
        else if (s === 17) { for (let r = 3 + bits(3); r > 0; r--) lens.push(0); }
        else { for (let r = 11 + bits(7); r > 0; r--) lens.push(0); }
      }
      lit = build(lens.slice(0, hlit)); dist = build(lens.slice(hlit));
    } else throw new Error('inflate: bad block type');
    for (;;) {
      const s = decode(lit);
      if (s < 256) out.push(s);
      else if (s === 256) break;
      else { const i = s - 257; const len = LB[i] + bits(LE[i]); const d = decode(dist); const off = DB[d] + bits(DE[d]); const start = out.length - off; for (let k = 0; k < len; k++) out.push(out[start + k]); }
    }
  }
  return Uint8Array.from(out);
}
function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('unzip: not a zip archive');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const files = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('unzip: bad central directory');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = u8.subarray(dataStart, dataStart + csize);
    if (method === 0) files[name] = raw; else if (method === 8) files[name] = inflateRaw(raw); else throw new Error(`unzip: method ${method} unsupported`);
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
