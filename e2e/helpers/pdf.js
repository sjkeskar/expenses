// Minimal text extraction for the PDFs jsPDF produces in this app: content
// streams are uncompressed and every text run is a literal "(…) Tj" string in
// WinAnsi (Windows-1252) encoding. Long table cells may be wrapped across
// several runs, so assert on short tokens (bill numbers, amounts, headings).
const fs = require("fs");

const decoder = new TextDecoder("windows-1252");

function unescapePdfString(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c !== 0x5c) {
      out.push(c);
      continue;
    }
    const n = bytes[++i];
    const simple = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };
    if (simple[n] !== undefined) out.push(simple[n]);
    else if (n >= 0x30 && n <= 0x37) {
      let oct = String.fromCharCode(n);
      while (oct.length < 3 && bytes[i + 1] >= 0x30 && bytes[i + 1] <= 0x37) oct += String.fromCharCode(bytes[++i]);
      out.push(parseInt(oct, 8));
    } else out.push(n); // \( \) \\
  }
  return decoder.decode(Uint8Array.from(out));
}

// Returns every text run in document order.
function pdfTextRuns(filePath) {
  const buf = fs.readFileSync(filePath);
  const latin = buf.toString("latin1");
  const runs = [];
  const re = /\(((?:\\.|[^\\)])*)\)\s*Tj/gs;
  let m;
  while ((m = re.exec(latin))) runs.push(unescapePdfString(Buffer.from(m[1], "latin1")));
  return runs;
}

// Saves a Playwright Download and returns { name, runs, text, flat }.
// `flat` joins runs with spaces, so a cell wrapped onto several lines still
// matches as one phrase.
async function readPdfDownload(download, dir) {
  const target = `${dir}/${download.suggestedFilename()}`;
  await download.saveAs(target);
  const head = fs.readFileSync(target).subarray(0, 5).toString();
  if (head !== "%PDF-") throw new Error(`${target} is not a PDF`);
  const runs = pdfTextRuns(target);
  return { name: download.suggestedFilename(), runs, text: runs.join("\n"), flat: runs.join(" ") };
}

module.exports = { pdfTextRuns, readPdfDownload };
