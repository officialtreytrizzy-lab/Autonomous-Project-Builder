import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, Packer,
  PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

const outputRoot = join(process.cwd(), 'tests', 'fixtures', 'intake');
mkdirSync(outputRoot, { recursive: true });
const fixedDate = new Date('2026-08-13T12:00:00.000Z');
const ink = rgb(0.055, 0.075, 0.12);
const cyan = rgb(0.16, 0.88, 0.94);
const muted = rgb(0.39, 0.44, 0.52);

function esc(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function svgPng(width, height, body, background = '#090d18') {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/>${body}</svg>`)).png().toBuffer();
}

function setMetadata(pdf, title) {
  pdf.setTitle(title); pdf.setAuthor('Autonomous Project Builder Test Suite');
  pdf.setSubject('Deterministic private multimodal intake evidence');
  pdf.setCreator('Autonomous Project Builder'); pdf.setProducer('Autonomous Project Builder');
  pdf.setCreationDate(fixedDate); pdf.setModificationDate(fixedDate);
}

function drawHeader(page, font, kicker, title) {
  page.drawText(kicker.toUpperCase(), { x: 54, y: 744, size: 8, font, color: cyan, characterSpacing: 1.5 });
  page.drawText(title, { x: 54, y: 708, size: 24, font, color: ink });
  page.drawLine({ start: { x: 54, y: 690 }, end: { x: 558, y: 690 }, thickness: 1, color: rgb(0.83, 0.86, 0.9) });
}

async function createUiRequirements() {
  const pdf = await PDFDocument.create(); setMetadata(pdf, 'UI Requirements');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const first = pdf.addPage([612, 792]); drawHeader(first, bold, 'Product evidence', 'Restaurant ordering interface');
  const lines = [
    'Outcome: a production-ready restaurant ordering application served privately on Computer 2.',
    'The home page must visibly contain LOCAL MULTIMODAL PASS.',
    'Guests browse categories, customize an item, review a cart, confirm the order, then pay.',
    'Do not require GitHub, Vercel, a backend, accounts, or seeded demo records.',
    'The production runtime must boot locally and return HTTP 200.',
  ];
  lines.forEach((line, index) => first.drawText(line, { x: 54, y: 648 - index * 34, size: 11, font: regular, color: index === 1 ? rgb(0.02, 0.44, 0.48) : muted, maxWidth: 500 }));
  first.drawText('Visual evidence on page 2 is equally authoritative.', { x: 54, y: 430, size: 10, font: bold, color: ink });

  const screenshot = await svgPng(1200, 760, `
    <text x="72" y="92" fill="#93f5ff" font-family="Arial" font-size="24" letter-spacing="5">EMBER / ORDER</text>
    <text x="72" y="176" fill="#f4f7ff" font-family="Arial" font-size="58" font-weight="700">Dinner, considered.</text>
    <text x="72" y="222" fill="#9daac4" font-family="Arial" font-size="24">Choose slowly. We will keep your place.</text>
    <rect x="72" y="280" width="670" height="338" rx="30" fill="#121a2b" stroke="#2ddfea" stroke-opacity=".45"/>
    <text x="112" y="338" fill="#a8b3ca" font-family="Arial" font-size="18">CHEF'S EVENING MENU</text>
    <text x="112" y="408" fill="#ffffff" font-family="Arial" font-size="34" font-weight="700">Charred citrus salmon</text>
    <text x="112" y="460" fill="#a8b3ca" font-family="Arial" font-size="20">Fennel, herbs, smoked lemon butter</text>
    <rect x="112" y="518" width="242" height="66" rx="33" fill="#2ddfea"/>
    <text x="153" y="560" fill="#061015" font-family="Arial" font-size="22" font-weight="700">Add to order</text>
    <rect x="790" y="280" width="338" height="338" rx="30" fill="#f4f7ff"/>
    <text x="834" y="340" fill="#687188" font-family="Arial" font-size="18">YOUR ORDER</text>
    <text x="834" y="402" fill="#0c1320" font-family="Arial" font-size="28" font-weight="700">2 selections</text>
    <line x1="834" y1="440" x2="1082" y2="440" stroke="#c9d0dd"/>
    <text x="834" y="492" fill="#0c1320" font-family="Arial" font-size="20">Total</text>
    <text x="1010" y="492" fill="#0c1320" font-family="Arial" font-size="20" font-weight="700">$48</text>
    <rect x="834" y="526" width="248" height="58" rx="29" fill="#0c1320"/>
    <text x="875" y="563" fill="#ffffff" font-family="Arial" font-size="19">Review order</text>`);
  const second = pdf.addPage([612, 792]); drawHeader(second, bold, 'Visual reference', 'Home and cart composition');
  second.drawImage(await pdf.embedPng(screenshot), { x: 42, y: 318, width: 528, height: 334.4 });
  second.drawText('The embedded screenshot defines hierarchy, cyan accent, rounded action controls, and a persistent order summary.', { x: 54, y: 272, size: 10, font: regular, color: muted, maxWidth: 500 });
  writeFileSync(join(outputRoot, 'ui-requirements.pdf'), await pdf.save({ useObjectStreams: false }));
}

async function createScannedRequirements() {
  const pdf = await PDFDocument.create(); setMetadata(pdf, 'Scanned Requirements');
  for (const [index, content] of [
    ['SCANNED PROJECT NOTES', 'Build a private local restaurant ordering app.', 'Required marker: LOCAL MULTIMODAL PASS', 'No backend. No demo data. No cloud deployment.'],
    ['HANDWRITTEN ACCEPTANCE LIST', '1. Browse menu', '2. Add and edit cart items', '3. Confirm order before payment', '4. Production runtime answers with HTTP 200'],
  ].entries()) {
    const titleSize = index === 1 ? 43 : 58;
    const bodySize = index === 1 ? 40 : 44;
    const scan = await svgPng(1275, 1650, `
      <rect x="58" y="62" width="1159" height="1526" rx="18" fill="#f8f2e5" stroke="#d0c2a8" stroke-width="3"/>
      <text x="${index === 1 ? 96 : 125}" y="220" fill="#243451" font-family="Georgia" font-size="${titleSize}" font-weight="700">${esc(content[0])}</text>
      ${content.slice(1).map((line, row) => `<text x="145" y="${390 + row * 170}" fill="#2f476d" font-family="Comic Sans MS, cursive" font-size="${bodySize}" transform="rotate(${row % 2 ? -1 : 1} 145 ${390 + row * 170})">${esc(line)}</text><line x1="120" y1="${430 + row * 170}" x2="1145" y2="${430 + row * 170}" stroke="#92b0d8" stroke-opacity=".4" stroke-width="2"/>`).join('')}
      <text x="1040" y="1500" fill="#8f7856" font-family="Arial" font-size="24">${index + 1}/2</text>`, '#d9d1c3');
    const page = pdf.addPage([612, 792]); page.drawImage(await pdf.embedPng(scan), { x: 0, y: 0, width: 612, height: 792 });
  }
  writeFileSync(join(outputRoot, 'scanned-requirements.pdf'), await pdf.save({ useObjectStreams: false }));
}

function roundedNode(page, font, x, y, width, label, accent = false) {
  page.drawRectangle({ x, y, width, height: 62, borderWidth: 1.5, borderColor: accent ? cyan : rgb(0.69, 0.74, 0.82), color: accent ? rgb(0.91, 0.99, 1) : rgb(0.97, 0.98, 1) });
  page.drawText(label, { x: x + 16, y: y + 24, size: 12, font, color: ink });
}

async function createRestaurantFlow() {
  const pdf = await PDFDocument.create(); setMetadata(pdf, 'Restaurant Flow');
  const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const first = pdf.addPage([612, 792]); drawHeader(first, bold, 'Application logic', 'Guest order journey');
  const nodes = [['Browse menu', 500], ['Customize item', 390], ['Review cart', 280], ['Confirm order', 170], ['Payment', 60]];
  nodes.forEach(([label, y], index) => { roundedNode(first, bold, 186, y, 240, label, index === 3); if (index < nodes.length - 1) { first.drawLine({ start: { x: 306, y }, end: { x: 306, y: y - 46 }, thickness: 2, color: cyan }); first.drawText('v', { x: 302, y: y - 50, size: 12, font: bold, color: cyan }); } });
  const second = pdf.addPage([612, 792]); drawHeader(second, bold, 'State behavior', 'Cart recovery and completion');
  roundedNode(second, bold, 54, 490, 160, 'Cart persisted'); roundedNode(second, bold, 398, 490, 160, 'Order confirmed', true); roundedNode(second, bold, 226, 310, 160, 'Payment retry');
  second.drawLine({ start: { x: 214, y: 520 }, end: { x: 398, y: 520 }, thickness: 2, color: cyan });
  second.drawLine({ start: { x: 478, y: 490 }, end: { x: 306, y: 372 }, thickness: 2, color: rgb(0.92, 0.58, 0.16) });
  second.drawLine({ start: { x: 306, y: 310 }, end: { x: 478, y: 490 }, thickness: 2, color: cyan });
  second.drawText('A failed payment preserves the cart, records the error, retries safely, and never duplicates the order.', { x: 54, y: 230, size: 11, font: regular, color: muted, maxWidth: 500 });
  writeFileSync(join(outputRoot, 'restaurant-flow.pdf'), await pdf.save({ useObjectStreams: false }));
}

async function createConflictBrief() {
  const pdf = await PDFDocument.create(); setMetadata(pdf, 'Conflict Brief');
  const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const first = pdf.addPage([612, 792]); drawHeader(first, bold, 'Written requirement', 'Checkout sequence');
  first.drawText('The customer must complete payment before the order confirmation screen appears.', { x: 54, y: 620, size: 14, font: bold, color: ink, maxWidth: 500 });
  first.drawText('Treat this requirement as authoritative unless contradictory evidence is present.', { x: 54, y: 548, size: 10, font: regular, color: muted, maxWidth: 500 });
  const second = pdf.addPage([612, 792]); drawHeader(second, bold, 'Flow diagram', 'Checkout sequence');
  roundedNode(second, bold, 54, 440, 150, 'Review cart'); roundedNode(second, bold, 231, 440, 150, 'Confirm order', true); roundedNode(second, bold, 408, 440, 150, 'Payment');
  second.drawLine({ start: { x: 204, y: 471 }, end: { x: 231, y: 471 }, thickness: 2, color: cyan }); second.drawText('>', { x: 218, y: 466, size: 12, font: bold, color: cyan });
  second.drawLine({ start: { x: 381, y: 471 }, end: { x: 408, y: 471 }, thickness: 2, color: cyan }); second.drawText('>', { x: 395, y: 466, size: 12, font: bold, color: cyan });
  second.drawText('The diagram intentionally places confirmation before payment.', { x: 54, y: 340, size: 11, font: regular, color: muted });
  writeFileSync(join(outputRoot, 'conflict-brief.pdf'), await pdf.save({ useObjectStreams: false }));
}

async function createProductBrief() {
  const wireframe = await svgPng(1200, 650, `
    <text x="54" y="72" fill="#8bf4ff" font-family="Arial" font-size="22" letter-spacing="4">LOCAL ORDER / WIREFRAME</text>
    <rect x="54" y="112" width="1092" height="470" rx="24" fill="#111a2b" stroke="#34445f"/>
    <rect x="86" y="150" width="630" height="82" rx="20" fill="#19243a"/><text x="118" y="202" fill="#ffffff" font-family="Arial" font-size="28" font-weight="700">Seasonal menu</text>
    <rect x="86" y="262" width="298" height="238" rx="20" fill="#202c43"/><rect x="418" y="262" width="298" height="238" rx="20" fill="#202c43"/>
    <rect x="754" y="150" width="360" height="350" rx="20" fill="#f5f7fb"/><text x="790" y="202" fill="#142036" font-family="Arial" font-size="24" font-weight="700">Your order</text>
    <rect x="790" y="404" width="288" height="58" rx="29" fill="#2ddfea"/><text x="852" y="441" fill="#071118" font-family="Arial" font-size="20" font-weight="700">Review cart</text>`);
  const borders = { top: { style: BorderStyle.SINGLE, size: 2, color: 'D8DEE8' }, bottom: { style: BorderStyle.SINGLE, size: 2, color: 'D8DEE8' }, left: { style: BorderStyle.SINGLE, size: 2, color: 'D8DEE8' }, right: { style: BorderStyle.SINGLE, size: 2, color: 'D8DEE8' }, insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E7EBF1' }, insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E7EBF1' } };
  const cell = (text, bold = false) => new TableCell({ width: { size: 4680, type: WidthType.DXA }, margins: { top: 120, bottom: 120, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text, bold, font: 'Calibri', size: 22, color: '162238' })] })] });
  const doc = new Document({
    creator: 'Autonomous Project Builder Test Suite', title: 'Product Brief', description: 'Deterministic multimodal DOCX evidence', created: fixedDate, modified: fixedDate,
    styles: { default: { document: { run: { font: 'Calibri', size: 22, color: '162238' }, paragraph: { spacing: { after: 120, line: 264 } } } }, paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: 'Calibri', size: 46, bold: true, color: '162238' }, paragraph: { spacing: { before: 0, after: 160 } } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Calibri', size: 32, bold: true, color: '2E74B5' }, paragraph: { spacing: { before: 320, after: 160 } } },
    ] },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: 'PRODUCT BRIEF  /  PRIVATE LOCAL', font: 'Calibri', size: 18, color: '657089' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT], font: 'Calibri', size: 18, color: '657089' })] })] }) },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun('Restaurant Ordering Application')] }),
        new Paragraph({ children: [new TextRun({ text: 'Source-grounded requirements fixture', bold: true, color: '2E74B5' })], spacing: { after: 320 } }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Finished outcome')] }),
        new Paragraph('Create a production-ready restaurant ordering application for a private local runtime on Computer 2. The home page must contain LOCAL MULTIMODAL PASS.'),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Requirements matrix')] }),
        new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680], borders, rows: [
          new TableRow({ tableHeader: true, children: [cell('Requirement', true), cell('Acceptance evidence', true)] }),
          new TableRow({ children: [cell('Local-first runtime'), cell('Production server boots locally and returns HTTP 200.')] }),
          new TableRow({ children: [cell('No demo records'), cell('Initial state is empty and all controls are functional.')] }),
          new TableRow({ children: [cell('Checkout flow'), cell('Review cart, confirm order, then pay.')] }),
        ] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Embedded wireframe')] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: wireframe, transformation: { width: 600, height: 325 }, type: 'png', altText: { title: 'Restaurant ordering wireframe', description: 'Menu grid beside a persistent order summary with cyan review action.', name: 'restaurant-wireframe' } })] }),
        new Paragraph({ children: [new TextRun({ text: 'Visual evidence: ', bold: true }), new TextRun('dark architectural surface, cyan focus accents, generous spacing, persistent cart summary, and rounded primary action.')] }),
      ],
    }],
  });
  const packed = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(packed);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.endsWith('.xml')) continue;
    const xml = await entry.async('string');
    zip.file(entry.name, xml
      .replaceAll(/w:rsid(?:R|RDefault|P|RPr|Del|Sect)="[^"]*"/g, '')
      .replaceAll(/<dcterms:created[^>]*>.*?<\/dcterms:created>/g, '<dcterms:created xsi:type="dcterms:W3CDTF">2026-08-13T12:00:00Z</dcterms:created>')
      .replaceAll(/<dcterms:modified[^>]*>.*?<\/dcterms:modified>/g, '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-13T12:00:00Z</dcterms:modified>'));
  }
  for (const entry of Object.values(zip.files)) entry.date = fixedDate;
  writeFileSync(join(outputRoot, 'product-brief.docx'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' }));
}

await createUiRequirements();
await createScannedRequirements();
await createRestaurantFlow();
await createProductBrief();
await createConflictBrief();
console.log(JSON.stringify({ ok: true, outputRoot, files: 5 }));
