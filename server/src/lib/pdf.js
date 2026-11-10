/**
 * A very small PDF writer.
 *
 * Why not a library: the receipt is the only PDF in the product, and pulling in a
 * PDF toolkit (and its fonts) to draw one page of text is a worse trade than 120
 * lines of PDF 1.4. Everything here is standard 14 fonts, so nothing to embed.
 *
 * The naira sign is not in WinAnsi, so money is written as `NGN 12,345` — which
 * is also how a bank statement in Nigeria prints it.
 */

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 48;

const clean = (s) =>
  String(s == null ? '' : s)
    .replace(/\u20a6/g, 'NGN ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7e]/g, '');

const escape = (s) => clean(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Estimated width of a Helvetica string in points (good enough to wrap). */
const widthOf = (text, size, bold) => clean(text).length * size * (bold ? 0.545 : 0.5);

function wrap(text, size, bold, maxWidth) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (widthOf(next, size, bold) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * Draw a document.
 * `blocks` is a list of { text, size, bold, color, gap, align, rule }.
 * Anything that runs past the page starts a new one, with the header repeated.
 */
export function buildPdf({ blocks, title = 'Document', author = 'BUYBUDDY', footer = null }) {
  const pages = [];
  let ops = [];
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    pages.push(ops.join('\n'));
    ops = [];
    y = PAGE_H - MARGIN;
  };

  const text = (str, { size = 11, bold = false, color = [0, 0, 0], align = 'left', x = MARGIN } = {}) => {
    const font = bold ? '/F2' : '/F1';
    let tx = x;
    if (align === 'right') tx = PAGE_W - MARGIN - widthOf(str, size, bold);
    else if (align === 'center') tx = (PAGE_W - widthOf(str, size, bold)) / 2;
    ops.push(`BT ${color.map((c) => c.toFixed(3)).join(' ')} rg ${font} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${escape(str)}) Tj ET`);
  };

  const rule = (color = [0.85, 0.87, 0.85]) => {
    ops.push(`${color.map((c) => c.toFixed(3)).join(' ')} RG 0.8 w ${MARGIN} ${y.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${y.toFixed(2)} l S`);
  };

  for (const b of blocks) {
    if (b.pageBreak) newPage();
    if (b.rule) {
      if (y < MARGIN + 40) newPage();
      y -= 6;
      rule();
      y -= 12;
      continue;
    }
    const size = b.size || 11;
    const bold = Boolean(b.bold);
    // A row with a label on the left and an amount on the right, on one line.
    if (b.pair) {
      if (y < MARGIN + 24) newPage();
      const [left, right] = b.pair;
      text(left, { size, bold, color: b.color });
      if (right) text(right, { size, bold, color: b.color, align: 'right' });
      y -= size * 1.6;
      continue;
    }
    if (b.raw) {
      for (const line of String(b.raw).split('\n')) {
        if (y < MARGIN + 24) newPage();
        text(line, { size, bold, color: b.color, align: b.align, x: b.x });
        y -= size * 1.35;
      }
      continue;
    }
    const lines = b.wrap === false ? [clean(b.text)] : wrap(b.text, size, bold, PAGE_W - 2 * MARGIN - (b.indent || 0));
    for (const line of lines) {
      if (y < MARGIN + 24) newPage();
      text(line, { size, bold, color: b.color, align: b.align });
      y -= size * 1.35;
    }
    y -= b.gap || 2;
  }
  pages.push(ops.join('\n'));

  // ---- assemble the file
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const kids = [];
  const pageObjs = [];
  // page objects and content streams, filled in after we know the ids
  const contentIds = pages.map((stream) =>
    add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
  );
  const pagesId = objects.length + pages.length + 1; // reserved below

  pages.forEach((_, i) => {
    const id = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
    );
    kids.push(`${id} 0 R`);
    pageObjs.push(id);
  });
  void pageObjs;

  const pagesObjId = add(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);
  const infoId = add(`<< /Title (${escape(title)}) /Author (${escape(author)}) /Producer (BUYBUDDY) >>`);

  const chunks = [];
  let offset = 0;
  const push = (s) => {
    chunks.push(s);
    offset += Buffer.byteLength(s, 'latin1');
  };
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(offset);
    push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`
  );
  void footer;
  return Buffer.concat(chunks.map((c) => Buffer.from(c, 'latin1')));
}

/** Money the way a Nigerian statement prints it, since ₦ is not in the font. */
export const money = (n) => `NGN ${Math.round(Number(n) || 0).toLocaleString('en-NG')}`;
