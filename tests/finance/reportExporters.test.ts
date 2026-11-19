import { describe, expect, it } from 'vitest';
import {
  generateCsvReport,
  generatePdfReport,
  generateXlsxReport,
  type TabularReportPayload,
} from '../../server/reports/exporters';

const SAMPLE_PAYLOAD: TabularReportPayload = {
  title: 'FINORA — Monthly Financial Report',
  subtitle: 'Period: 2026-11-01 to 2026-11-30 | Currency: UZS',
  summary: [
    { label: 'Total Income', value: '15000000.0000 UZS' },
    { label: 'Total Expenses', value: '4500000.0000 UZS' },
    { label: 'Net Cash Flow', value: '10500000.0000 UZS' },
  ],
  headers: ['Period', 'Transactions', 'Income', 'Expense', 'Net Cash Flow'],
  rows: [
    ['2026-11', 12, '15000000.0000', '4500000.0000', '10500000.0000'],
    ['2026-10', 9, '12000000.0000', '3800000.0000', '8200000.0000'],
  ],
};

describe('On-demand CSV, binary OpenXML XLSX, and binary PDF-1.4 exporters', () => {
  it('generates UTF-8 BOM CSV with escaped cells and summary metrics', () => {
    const csvBuf = generateCsvReport(SAMPLE_PAYLOAD);
    const text = csvBuf.toString('utf8');
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('FINORA — Monthly Financial Report');
    expect(text).toContain('Total Income,15000000.0000 UZS');
    expect(text).toContain('2026-11,12,15000000.0000,4500000.0000,10500000.0000');
  });

  it('generates a valid ZIP-packaged OpenXML .xlsx workbook', () => {
    const xlsxBuf = generateXlsxReport(SAMPLE_PAYLOAD);
    // ZIP local file header magic bytes PK\x03\x04
    expect(xlsxBuf.readUInt32LE(0)).toBe(0x04034b50);
    const ascii = xlsxBuf.toString('utf8');
    expect(ascii).toContain('[Content_Types].xml');
    expect(ascii).toContain('xl/workbook.xml');
    expect(ascii).toContain('xl/worksheets/sheet1.xml');
    expect(ascii).toContain('15000000.0000');
  });

  it('generates a valid binary %PDF-1.4 document with xref table and %%EOF', () => {
    const pdfBuf = generatePdfReport(SAMPLE_PAYLOAD);
    const text = pdfBuf.toString('utf8');
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/BaseFont /Courier');
    expect(text).toContain('xref\n');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
