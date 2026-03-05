
import * as pdfjsLib from 'pdfjs-dist';
import { PaperSegment } from '../types';

// Robustly handle the export whether it is a default export or named exports
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

// CRITICAL FIX: Ensure Worker is loaded from CDN matching the installed version
// Using standard cloudflare CDN for reliability
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = error => reject(error);
  });
};

export const downloadText = (filename: string, text: string) => {
  const element = document.createElement('a');
  const file = new Blob([text], {type: 'text/plain'});
  element.href = URL.createObjectURL(file);
  element.download = filename;
  document.body.appendChild(element); 
  element.click();
  document.body.removeChild(element);
};

export const openInNewWindow = (content: string, title: string = 'Document') => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const safeTitle = escapeHtml(title);
    const safeContent = escapeHtml(content);

    win.document.write(`
        <html>
            <head>
                <title>${safeTitle}</title>
                <style>
                    :root { --content-font-size: 14px; }
                    body { font-family: sans-serif; margin: 0; line-height: 1.6; color: #333; background: #fff; }
                    .toolbar {
                        position: sticky;
                        top: 0;
                        display: flex;
                        gap: 8px;
                        align-items: center;
                        padding: 10px 16px;
                        background: #ffffff;
                        border-bottom: 1px solid #e5e7eb;
                        z-index: 10;
                    }
                    .toolbar button {
                        padding: 8px 12px;
                        border: 1px solid #d1d5db;
                        border-radius: 8px;
                        background: #f9fafb;
                        cursor: pointer;
                        font-size: 12px;
                    }
                    .toolbar button:hover { background: #f3f4f6; }
                    .zoom-label { font-size: 12px; color: #4b5563; min-width: 56px; text-align: center; }
                    .container { padding: 24px; }
                    h1 { margin-top: 0; margin-bottom: 16px; }
                    pre {
                        white-space: pre-wrap;
                        background: #f4f4f5;
                        padding: 20px;
                        border-radius: 8px;
                        font-size: var(--content-font-size);
                        overflow-x: auto;
                    }
                </style>
            </head>
            <body>
                <div class="toolbar">
                    <button id="zoomOutBtn">축소 -</button>
                    <button id="zoomInBtn">확대 +</button>
                    <button id="zoomResetBtn">초기화</button>
                    <span id="zoomLabel" class="zoom-label">100%</span>
                    <button id="copyBtn">복사</button>
                    <button id="printBtn">Print / Save as PDF</button>
                </div>
                <div class="container">
                    <h1>${safeTitle}</h1>
                    <pre id="scriptContent">${safeContent}</pre>
                </div>
                <script>
                    (function() {
                        var pre = document.getElementById('scriptContent');
                        var root = document.documentElement;
                        var zoomLabel = document.getElementById('zoomLabel');
                        var currentScale = 1;
                        var minScale = 0.7;
                        var maxScale = 2.0;
                        var step = 0.1;

                        function updateZoom() {
                            var size = 14 * currentScale;
                            root.style.setProperty('--content-font-size', size + 'px');
                            if (zoomLabel) zoomLabel.textContent = Math.round(currentScale * 100) + '%';
                        }

                        function copyText() {
                            var text = pre ? pre.textContent || '' : '';
                            if (!text) return;
                            if (navigator.clipboard && window.isSecureContext) {
                                navigator.clipboard.writeText(text);
                                return;
                            }
                            var temp = document.createElement('textarea');
                            temp.value = text;
                            document.body.appendChild(temp);
                            temp.select();
                            document.execCommand('copy');
                            document.body.removeChild(temp);
                        }

                        document.getElementById('zoomInBtn')?.addEventListener('click', function() {
                            currentScale = Math.min(maxScale, currentScale + step);
                            updateZoom();
                        });
                        document.getElementById('zoomOutBtn')?.addEventListener('click', function() {
                            currentScale = Math.max(minScale, currentScale - step);
                            updateZoom();
                        });
                        document.getElementById('zoomResetBtn')?.addEventListener('click', function() {
                            currentScale = 1;
                            updateZoom();
                        });
                        document.getElementById('copyBtn')?.addEventListener('click', function() {
                            copyText();
                        });
                        document.getElementById('printBtn')?.addEventListener('click', function() {
                            window.print();
                        });

                        updateZoom();
                    })();
                </script>
            </body>
        </html>
    `);
    win.document.close();
};

// --- PDF Image Extraction Logic ---

export interface PageImage {
  pageIndex: number;
  base64: string;
  width: number;
  height: number;
}

/** Result of extracting text from a single PDF page (for verification and AI). */
export interface ExtractedPageText {
  pageIndex: number;
  /** Plain text for this page (no marker). */
  text: string;
  /** Same text with page marker for verification (e.g. "--- Page 1 ---\\n..."). */
  textWithPageMarker: string;
}

export const getPdfPageCount = async (file: File): Promise<number> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({
          data: arrayBuffer,
          cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
        });
        const pdf = await loadingTask.promise;
        return pdf.numPages;
    } catch (e) {
        console.error("Failed to get page count", e);
        return 0;
    }
};

export const extractTextFromPdfPages = async (file: File, maxPages: number = 9999): Promise<ExtractedPageText[]> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({
      data: arrayBuffer,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
    });
    const pdf = await loadingTask.promise;
    const numPages = Math.min(pdf.numPages, maxPages);
    const result: ExtractedPageText[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const lines: string[] = [];
      let lastY: number | null = null;
      const lineGap = 5;
      for (const item of textContent.items as { str?: string; transform?: number[] }[]) {
        const str = item.str ?? '';
        if (!str) continue;
        const y = item.transform?.[5] ?? 0;
        if (lastY !== null && Math.abs(y - lastY) > lineGap) lines.push('\n');
        lines.push(str);
        lastY = y;
      }
      const text = lines.join('').replace(/\n+/g, '\n').trim();
      const pageMarker = `\n--- Page ${i} ---\n`;
      result.push({ pageIndex: i, text, textWithPageMarker: pageMarker + (text || '(no text)') + '\n' });
    }
    return result;
  } catch (error) {
    console.error("PDF text extraction error:", error);
    throw new Error("Failed to extract text from PDF.");
  }
};

export const renderPdfPagesToImages = async (file: File, maxPages: number = 5): Promise<PageImage[]> => {
  try {
      const arrayBuffer = await file.arrayBuffer();
      // FIX: Add cMapUrl to support Korean/Special fonts properly (avoids X boxes)
      const loadingTask = pdfjs.getDocument({
        data: arrayBuffer,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
      });

      const pdf = await loadingTask.promise;
      const numPages = Math.min(pdf.numPages, maxPages);
      const images: PageImage[] = [];

      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); 
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        if (!context) continue;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;

        const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        images.push({
          pageIndex: i,
          base64,
          width: viewport.width,
          height: viewport.height
        });
      }
      return images;
  } catch (error) {
      console.error("PDF Render Error:", error);
      throw new Error("Failed to render PDF. Please ensure it is a valid PDF file.");
  }
};

export const cropImageFromCanvas = (
  fullPageBase64: string, 
  box: [number, number, number, number], 
  pageWidth: number, 
  pageHeight: number
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const [ymin, xmin, ymax, xmax] = box;
      
      const x = (xmin / 1000) * pageWidth;
      const y = (ymin / 1000) * pageHeight;
      const w = ((xmax - xmin) / 1000) * pageWidth;
      const h = ((ymax - ymin) / 1000) * pageHeight;

      const padding = 20;
      const sx = Math.max(0, x - padding);
      const sy = Math.max(0, y - padding);
      const sw = Math.min(pageWidth - sx, w + padding * 2);
      const sh = Math.min(pageHeight - sy, h + padding * 2);

      canvas.width = sw;
      canvas.height = sh;

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = `data:image/jpeg;base64,${fullPageBase64}`;
  });
};

export const printTranslatedPdf = (title: string, segments: PaperSegment[], fontSizePercentage: number = 100) => {
  const printWindow = window.open('', '_blank');
  
  if (!printWindow) {
    alert("Pop-up blocked. Please allow pop-ups for this site to download the PDF.");
    return;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title} - Translated</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
        <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
        <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
        
        <style>
          @media print {
            @page { margin: 2cm; }
            body { -webkit-print-color-adjust: exact; }
            .no-print { display: none; }
          }
          body { 
            font-family: 'Times New Roman', serif; 
            padding: 40px; 
            line-height: 1.6; 
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            font-size: ${fontSizePercentage}%;
          }
          h1 { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
          .segment { margin-bottom: 24px; page-break-inside: avoid; }
          
          /* FIX: Use white-space: pre-wrap instead of replacing \\n with <br> to preserve LaTeX structure */
          .translated { 
            color: #000; 
            text-align: justify;
            white-space: pre-wrap; 
          }
          .heading .translated { 
            font-weight: bold; 
            font-size: 1.4em; 
            margin-top: 30px; 
            color: #111;
            border-bottom: 1px solid #ddd;
            padding-bottom: 5px;
            display: block;
          }
          .figure_caption { 
            font-style: italic; 
            background: #f0f9ff;
            padding: 10px;
            border-radius: 4px;
            font-size: 0.9em;
            color: #0369a1;
          }
          .equation {
            margin: 15px 0;
            padding: 10px;
            background: #fafafa;
            border-radius: 4px;
            text-align: center;
          }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 0.9em; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f3f4f6; }
          
          pre {
            background-color: #1e293b;
            color: #e2e8f0;
            padding: 15px;
            border-radius: 6px;
            overflow-x: auto;
            font-family: 'Courier New', Courier, monospace;
            font-size: 0.85em;
            white-space: pre-wrap; 
          }
          
          .user-note {
             margin-top: 5px;
             font-size: 0.85em;
             color: #4b5563;
             background-color: #fffbeb;
             border-left: 3px solid #f59e0b;
             padding: 5px 10px;
          }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        ${segments.map(s => {
          let content = s.translated;
          
          // Basic formatting
          content = content.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
          content = content.replace(/\*(.*?)\*/g, '<i>$1</i>');
          
          if (s.type === 'code' || content.startsWith('```')) {
             const codeContent = content.replace(/```/g, '');
             content = `<pre>${codeContent}</pre>`;
          } 
          else if ((s.type === 'table' || content.includes('|')) && content.includes('---')) {
             const rows = content.split('\n').filter(r => r.trim().startsWith('|'));
             if (rows.length > 0) {
                 const htmlRows = rows.map((r, i) => {
                     if (r.includes('---')) return ''; 
                     const cols = r.split('|').filter(c => c.trim() !== '').map(c => 
                        i === 0 ? `<th>${c.trim()}</th>` : `<td>${c.trim()}</td>`
                     ).join('');
                     return `<tr>${cols}</tr>`;
                 }).join('');
                 content = `<table>${htmlRows}</table>`;
             }
          }
          
          // REMOVED: content = content.replace(/\n\n/g, '<br/><br/>'); 
          // This was breaking LaTeX blocks. We rely on CSS white-space: pre-wrap now.

          const noteHtml = s.userNote ? `<div class="user-note"><strong>Note:</strong> ${s.userNote}</div>` : '';

          return `
          <div class="segment ${s.type}">
            <div class="translated">${content}</div>
            ${noteHtml}
          </div>
        `}).join('')}
        
        <div class="no-print" style="position:fixed; top:20px; right:20px; background:yellow; padding:10px; z-index:100;">
           Rendering Math... please wait...
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
                try {
                    renderMathInElement(document.body, {
                      delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\\\(', right: '\\\\)', display: false},
                        {left: '\\\\begin{align*}', right: '\\\\end{align*}', display: true},
                        {left: '\\\\[', right: '\\\\]', display: true}
                      ],
                      throwOnError : false
                    });
                } catch(e) {
                    console.error("Katex Error", e);
                }
                
                // Hide loading message and print
                document.querySelector('.no-print').style.display = 'none';
                setTimeout(() => {
                    window.print();
                }, 500);
            }, 1000); // Wait for scripts to load
          }
        </script>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();
};
