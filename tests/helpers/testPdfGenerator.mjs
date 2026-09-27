/**
 * Minimal deterministic PDF 1.4 binary generator for automated tests.
 * Generates valid multi-page PDF documents with selectable text.
 * No external PDF creation library required.
 */

export function createTestPdfBytes(pageTexts = ['Page 1 content']) {
    const numPages = pageTexts.length;
    let out = '%PDF-1.4\n';
    const offsets = [];

    function addObj(str) {
        offsets.push(Buffer.byteLength(out, 'utf-8'));
        out += str + '\n';
    }

    // Object 1: Catalog
    addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');

    // Object 2: Pages root
    const kids = [];
    for (let i = 0; i < numPages; i++) {
        kids.push(`${3 + i * 2} 0 R`);
    }
    addObj(`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${numPages} >>\nendobj`);

    const fontObjNum = 3 + numPages * 2;

    for (let i = 0; i < numPages; i++) {
        const pageObjNum = 3 + i * 2;
        const contentObjNum = pageObjNum + 1;
        addObj(`${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj`);

        const text = pageTexts[i] || '';
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
        let streamContent = '';
        if (lines.length > 0) {
            const commands = lines.map((line, lineIdx) => {
                const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                return lineIdx === 0
                    ? `50 720 Td (${escaped}) Tj`
                    : `0 -24 Td (${escaped}) Tj`;
            });
            streamContent = `BT\n/F1 12 Tf\n${commands.join('\n')}\nET`;
        }
        addObj(`${contentObjNum} 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'utf-8')} >>\nstream\n${streamContent}\nendstream\nendobj`);
    }

    // Font object
    addObj(`${fontObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);

    // Cross-reference table
    const xrefOffset = Buffer.byteLength(out, 'utf-8');
    out += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
    for (let i = 0; i < offsets.length; i++) {
        out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    out += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return new Uint8Array(Buffer.from(out, 'utf-8'));
}
