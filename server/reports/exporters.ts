export interface TabularReportPayload {
  title: string;
  subtitle: string;
  summary: Array<{ label: string; value: string }>;
  headers: string[];
  rows: Array<Array<string | number>>;
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an RFC 4180 UTF-8 CSV buffer (with BOM for Excel compatibility).
 */
export function generateCsvReport(payload: TabularReportPayload): Buffer {
  const lines: string[] = [];
  lines.push(escapeCsvCell(payload.title));
  lines.push(escapeCsvCell(payload.subtitle));
  lines.push('');

  for (const item of payload.summary) {
    lines.push(`${escapeCsvCell(item.label)},${escapeCsvCell(item.value)}`);
  }
  lines.push('');
  lines.push(payload.headers.map(escapeCsvCell).join(','));

  for (const row of payload.rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }

  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnLetter(colIndex: number): string {
  let n = colIndex + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = file.data;
    const crc = crc32(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression = 0 (stored)
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/**
 * Generates a genuine OpenXML (.xlsx) binary workbook container without external dependencies.
 */
export function generateXlsxReport(payload: TabularReportPayload): Buffer {
  const allRows: Array<Array<string | number>> = [
    [payload.title],
    [payload.subtitle],
    [],
    ...payload.summary.map((s) => [s.label, s.value]),
    [],
    payload.headers,
    ...payload.rows,
  ];

  const sheetRowsXml = allRows
    .map((row, rowIdx) => {
      const rNum = rowIdx + 1;
      const cellsXml = row
        .map((cell, colIdx) => {
          const ref = `${columnLetter(colIdx)}${rNum}`;
          if (typeof cell === 'number' && Number.isFinite(cell)) {
            return `<c r="${ref}" t="n"><v>${cell}</v></c>`;
          }
          const strVal = String(cell ?? '');
          if (/^-?\d+(\.\d+)?$/.test(strVal) && rowIdx > 5 && colIdx > 0) {
            return `<c r="${ref}" t="n"><v>${strVal}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(strVal)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rNum}">${cellsXml}</row>`;
    })
    .join('');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="FINORA Report" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRowsXml}</sheetData>
</worksheet>`;

  return buildStoredZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRelsXml, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRelsXml, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(worksheetXml, 'utf8') },
  ]);
}

function toAsciiPdfSafe(input: string): string {
  // Standard PDF Type1 Helvetica supports WinAnsi/ASCII; transliterate/strip non-ASCII safely
  const ascii = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?');
  return ascii.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Generates a valid binary PDF-1.4 document with formatted financial summary and table rows.
 */
export function generatePdfReport(payload: TabularReportPayload): Buffer {
  const lines: string[] = [];
  lines.push(payload.title.toUpperCase());
  lines.push(payload.subtitle);
  lines.push('-'.repeat(90));

  for (const item of payload.summary) {
    lines.push(`${item.label.padEnd(32, ' ')} : ${item.value}`);
  }

  lines.push('-'.repeat(90));
  lines.push(payload.headers.map((h) => h.slice(0, 16).padEnd(17, ' ')).join(' '));
  lines.push('-'.repeat(90));

  for (const row of payload.rows.slice(0, 42)) {
    lines.push(
      row.map((cell) => String(cell ?? '').slice(0, 16).padEnd(17, ' ')).join(' '),
    );
  }

  const streamCommands: string[] = ['BT', '/F1 10 Tf', '36 790 Td', '14 TL'];
  lines.forEach((line, idx) => {
    const safe = toAsciiPdfSafe(line);
    if (idx === 0) {
      streamCommands.push(`(${safe}) Tj`);
    } else {
      streamCommands.push(`T* (${safe}) Tj`);
    }
  });
  streamCommands.push('ET');
  const contentStream = streamCommands.join('\n');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += obj;
  }

  const xrefOffset = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, 'utf8');
}
