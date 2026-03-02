
import React, { useRef, useState, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import * as pdfjsLib from 'pdfjs-dist';
import { PaperSegment, SegmentType } from '../types';

// Ensure worker is set for internal viewer as well
const pdfjs = (pdfjsLib as any).default || pdfjsLib;
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

// Error Boundary for Markdown Content
class MarkdownErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Markdown Rendering Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-2 my-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 font-mono">
           ⚠️ Content rendering error (Raw text preserved below).
        </div>
      );
    }
    return this.props.children;
  }
}

interface TwinViewProps {
  segments: PaperSegment[];
  highlightedId: string | null;
  onHoverSegment: (id: string | null) => void;
  onCitationClick: (citation: string) => void;
  pdfUrl: string | null;
  currentRange: string;
  onNavigatePage: (direction: 'next' | 'prev') => void;
  onExplainSegment: (id: string, userPrompt?: string) => void; 
  onToggleBookmark: (id: string) => void;
  onUpdateNote: (id: string, note: string) => void;
  onSyncScroll: (percentage: number) => void; 
  onRetranslatePage?: (pageIndex: number) => void; 
  onLoadNextBatch?: () => void; 
}

const SegmentBlock: React.FC<{
  segment: PaperSegment;
  content: string;
  isKorean: boolean;
  highlighted: boolean;
  onHover: () => void;
  onCitationClick: (c: string) => void;
  onExplain: (id: string, userPrompt?: string) => void;
  onToggleBookmark: (id: string) => void;
  onUpdateNote: (id: string, note: string) => void;
}> = ({ segment, content, isKorean, highlighted, onHover, onCitationClick, onExplain, onToggleBookmark, onUpdateNote }) => {
  const [showOriginalOverlay, setShowOriginalOverlay] = useState(false);
  const [isExplanationCollapsed, setIsExplanationCollapsed] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  
  // Interactive Explanation State
  const [showExplainInput, setShowExplainInput] = useState(false);
  const [customExplainPrompt, setCustomExplainPrompt] = useState("");

  // MD View State (Forced LaTeX Rendering)
  const [forceMdView, setForceMdView] = useState(false);

  const handleCustomExplainSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (customExplainPrompt.trim()) {
          onExplain(segment.id, customExplainPrompt);
          setShowExplainInput(false);
          setIsExplanationCollapsed(false); 
      }
  };

  const handleExplainClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExplain(segment.id);
  };

  const explanationToShow = isKorean ? segment.explanation : segment.explanationEn;

  // Function to wrap content in $$ if MD View is forced
  const getRenderContent = (text: string) => {
      if (forceMdView) {
          // Check if it already has delimiters, if not, wrap it
          const trimmed = text.trim();
          if (!trimmed.startsWith('$$') && !trimmed.startsWith('$')) {
              return `$$\n${trimmed}\n$$`;
          }
      }
      return text;
  };

  const MarkdownRenderer = ({ text }: { text: string }) => (
    <MarkdownErrorBoundary>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm, remarkMath]} 
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, output: 'mathml' }], rehypeRaw]}
        components={{
          p: ({node, ...props}) => <p className="mb-2 last:mb-0 leading-relaxed whitespace-pre-wrap" {...props} />, 
          table: ({node, ...props}) => <div className="overflow-x-auto my-4"><table className="min-w-full divide-y divide-gray-200 border text-sm" {...props} /></div>,
          thead: ({node, ...props}) => <thead className="bg-gray-50" {...props} />,
          tbody: ({node, ...props}) => <tbody className="bg-white divide-y divide-gray-200" {...props} />,
          tr: ({node, ...props}) => <tr className="hover:bg-gray-50" {...props} />,
          th: ({node, ...props}) => <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b" {...props} />,
          td: ({node, ...props}) => <td className="px-3 py-2 whitespace-normal text-gray-700 border-b border-r last:border-r-0 align-top" {...props} />,
          code: ({node, ...props}) => {
            const isBlock = String(props.children).includes('\n');
            return (
              <code 
                className={`${isBlock ? 'block bg-gray-800 text-gray-100 p-3 rounded-lg overflow-x-auto my-2' : 'bg-gray-100 text-pink-600 rounded px-1 py-0.5'} text-sm font-mono whitespace-pre`} 
                {...props} 
              />
            );
          },
          pre: ({node, ...props}) => <div className="not-prose" {...(props as any)} />,
        }}
      >
        {getRenderContent(text) || ''}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );

  const renderContent = () => {
    const textToShow = (showOriginalOverlay && isKorean) ? segment.original : content;

    if (segment.type === SegmentType.HEADING) {
      return <h3 className="text-xl font-bold mb-3 mt-5 text-slate-900 border-b border-gray-100 pb-1"><MarkdownRenderer text={textToShow} /></h3>;
    }
    if (segment.type === SegmentType.ABSTRACT) {
        return (
            <div className="bg-indigo-50/50 p-4 rounded-lg border-l-4 border-indigo-300 my-4 text-sm leading-relaxed text-slate-800 shadow-sm">
                <span className="text-xs font-bold text-indigo-500 uppercase block mb-1">Abstract</span>
                <MarkdownRenderer text={textToShow} />
            </div>
        );
    }
    if (segment.type === SegmentType.FIGURE_CAPTION) {
      return (
        <div className="my-3 p-3 bg-gray-50 rounded border-l-4 border-gray-400 text-sm italic text-gray-700">
          <span className="font-semibold block not-italic mb-1 text-xs uppercase text-gray-500">{isKorean ? "그림 설명" : "Figure Caption"}</span>
          <MarkdownRenderer text={textToShow} />
        </div>
      );
    }
    if (segment.type === SegmentType.EQUATION) {
      return (
        <div className="my-3 py-2 px-2 overflow-x-auto bg-white rounded border border-gray-100 shadow-sm text-center">
           <MarkdownRenderer text={textToShow} />
        </div>
      );
    }
    if (segment.type === SegmentType.CODE) {
        return (
            <div className="my-3 p-4 bg-slate-900 rounded-lg text-gray-200 font-mono text-sm overflow-x-auto whitespace-pre">
                <MarkdownRenderer text={textToShow} />
            </div>
        )
    }
    if (segment.type === SegmentType.TABLE) {
        return (
            <div className="my-4">
                <span className="text-xs font-bold text-gray-400 uppercase mb-1 block">Table Data</span>
                <MarkdownRenderer text={textToShow} />
            </div>
        )
    }

    return (
      <div className={`text-base ${showOriginalOverlay ? 'text-gray-500 italic' : 'text-slate-800'}`}>
        <MarkdownRenderer text={textToShow} />
      </div>
    );
  };

  const renderCitationLinks = () => {
    if (!segment.citations || segment.citations.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {segment.citations.map((citation, idx) => (
          <button
            key={idx}
            onClick={(e) => { e.stopPropagation(); onCitationClick(citation); }}
            className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-100 transition-colors flex items-center gap-1 border border-indigo-100"
            title="Find Reference"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
               <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243h.001l.497-.5a.75.75 0 0 1 1.064 1.057l-.498.501-.002.002a4.5 4.5 0 0 1-6.364-6.364l7-7a4.5 4.5 0 0 1 6.368 6.36l-3.455 3.553A2.625 2.625 0 1 1 9.52 9.52l3.45-3.451a.75.75 0 1 1 1.061 1.06l-3.45 3.451a1.125 1.125 0 0 0 1.587 1.595l3.454-3.553a3 3 0 0 0 0-4.242Z" clipRule="evenodd" />
            </svg>
            {citation}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div
      id={`${isKorean ? 'trans' : 'orig'}-${segment.id}`}
      className={`relative group transition-all duration-200 rounded-lg p-4 mb-4 cursor-pointer border ${
        highlighted ? 'bg-indigo-50/50 border-indigo-200 shadow-sm ring-1 ring-indigo-200' : 'bg-transparent border-transparent hover:bg-gray-50 hover:border-gray-200'
      } ${segment.isBookmarked && isKorean ? 'ring-2 ring-yellow-400 bg-yellow-50' : ''}`}
      onMouseEnter={onHover}
      onClick={onHover}
    >
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20 bg-white/80 backdrop-blur-sm rounded-lg p-0.5 border border-gray-100 shadow-sm">
        {/* Toggle MD View */}
        <button
            onClick={(e) => { e.stopPropagation(); setForceMdView(!forceMdView); }}
            className={`p-1.5 rounded transition-colors text-[10px] font-bold border border-gray-200 ${forceMdView ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
            title="Toggle Markdown/Math View"
        >
            MD
        </button>

        {isKorean && (
            <button 
                onClick={(e) => { e.stopPropagation(); onToggleBookmark(segment.id); }}
                className={`p-1.5 rounded transition-colors ${segment.isBookmarked ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-400 hover:text-yellow-500'}`}
                title={segment.isBookmarked ? "Remove Bookmark" : "Bookmark this block"}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 0 1-1.085.67L12 18.089l-7.165 3.583A.75.75 0 0 1 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" clipRule="evenodd" />
                </svg>
            </button>
        )}
        {isKorean && (
             <button 
                onClick={(e) => { e.stopPropagation(); setShowNoteInput(!showNoteInput); }}
                className={`p-1.5 rounded transition-colors ${segment.userNote ? 'text-green-600' : 'text-gray-400 hover:text-green-600'}`}
                title="Add Note"
             >
                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M4.125 3C3.089 3 2.25 3.84 2.25 4.875V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V4.875C21.75 3.84 20.91 3 19.875 3H4.125ZM12 5.75a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
                 </svg>
             </button>
        )}
        {isKorean && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowOriginalOverlay(!showOriginalOverlay); }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${showOriginalOverlay ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-500'}`}
            title="Toggle Original Text"
          >
            <span>{showOriginalOverlay ? 'En' : 'Orig'}</span>
          </button>
        )}
        
        {/* Interactive Pencil Icon for Custom Explain */}
        <button
            onClick={(e) => { e.stopPropagation(); setShowExplainInput(!showExplainInput); }}
            className="p-1.5 rounded transition-colors text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
            title="Ask a specific question"
        >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
            </svg>
        </button>

        <button
          onClick={handleExplainClick}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-indigo-50 text-xs font-medium text-gray-500 hover:text-indigo-600 transition-colors"
          title="Auto AI Explain"
        >
          {segment.isExplaining ? (
             <svg className="animate-spin h-3 w-3 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
             </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
            </svg>
          )}
          <span>{segment.explanation ? 'Check' : 'Deep Explain'}</span>
        </button>
      </div>

      {renderContent()}
      
      {renderCitationLinks()}

      {/* Input for custom explanation */}
      {showExplainInput && (
          <div className="mt-3 relative p-3 bg-indigo-50 border border-indigo-100 rounded-lg" onClick={(e) => e.stopPropagation()}>
              <label className="block text-[10px] font-bold text-indigo-700 uppercase mb-1">Ask AI Professor</label>
              <form onSubmit={handleCustomExplainSubmit}>
                  <textarea
                      className="w-full text-xs p-2 border border-indigo-200 bg-white rounded focus:ring-1 focus:ring-indigo-400 outline-none text-gray-700 placeholder-gray-400"
                      placeholder="e.g., Explain what 'gamma' represents in this equation..."
                      rows={2}
                      value={customExplainPrompt}
                      onChange={(e) => setCustomExplainPrompt(e.target.value)}
                      autoFocus
                  />
                  <div className="flex justify-end gap-2 mt-2">
                      <button 
                          type="button" 
                          onClick={() => setShowExplainInput(false)} 
                          className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1"
                      >
                          Cancel
                      </button>
                      <button 
                          type="submit"
                          className="text-xs bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 font-medium"
                      >
                          Ask AI
                      </button>
                  </div>
              </form>
          </div>
      )}

      {isKorean && (showNoteInput || segment.userNote) && (
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
              <textarea 
                  className="w-full text-xs p-2 border border-yellow-200 bg-yellow-50 rounded focus:ring-1 focus:ring-yellow-400 outline-none text-gray-700"
                  placeholder="Add your note here..."
                  rows={2}
                  value={segment.userNote || ''}
                  onChange={(e) => onUpdateNote(segment.id, e.target.value)}
              />
          </div>
      )}

      {explanationToShow && !isExplanationCollapsed && (
        <div className="mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-lg text-sm text-gray-800 animate-in fade-in slide-in-from-top-2 relative">
           <button 
             onClick={(e) => { e.stopPropagation(); setIsExplanationCollapsed(true); }}
             className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
             title="Collapse"
           >
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
               <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
             </svg>
           </button>
           <div className="flex items-center gap-2 mb-2">
             <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded">AI PROFESSOR ({isKorean ? 'KO' : 'EN'})</span>
           </div>
           <div className="prose prose-sm max-w-none">
             <MarkdownErrorBoundary>
                <ReactMarkdown 
                remarkPlugins={[remarkGfm, remarkMath]} 
                rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }], rehypeRaw]} 
                >
                {explanationToShow}
                </ReactMarkdown>
             </MarkdownErrorBoundary>
           </div>
        </div>
      )}
    </div>
  );
};

const FigureList: React.FC<{
    figures: PaperSegment[];
    onExplain: (id: string, userPrompt?: string) => void;
}> = ({ figures, onExplain }) => {
    return (
        <div className="p-6">
            <div className="mb-6 p-4 bg-blue-50 text-blue-800 rounded-lg text-sm border border-blue-100">
               <strong>Detected Figures & Tables</strong>
            </div>
            {figures.length === 0 ? (
                <div className="text-center text-gray-400 mt-10">No figures found.</div>
            ) : (
                figures.map((fig) => (
                    <div key={fig.id} className="mb-6 border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
                         <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 font-bold text-gray-700 text-sm flex justify-between items-center">
                            <span>{fig.type === SegmentType.FIGURE_CAPTION ? 'Figure' : 'Table'}</span>
                         </div>
                         <div className="p-4">
                            <div className="text-base font-medium text-gray-800 mb-4 bg-gray-50 p-3 rounded italic border-l-4 border-gray-300">
                                {fig.original}
                            </div>
                            <button 
                                onClick={() => onExplain(fig.id)}
                                className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded hover:bg-indigo-700"
                            >
                                Deep Explain
                            </button>
                         </div>
                    </div>
                ))
            )}
        </div>
    );
};

// Internal PDF Renderer component for TwinView
const InternalPdfRenderer: React.FC<{ pdfUrl: string; zoomPercent: number }> = ({ pdfUrl, zoomPercent }) => {
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [numPages, setNumPages] = useState(0);
    const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

    useEffect(() => {
        const loadPdf = async () => {
            try {
                const loadingTask = pdfjs.getDocument({
                    url: pdfUrl,
                    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
                    cMapPacked: true,
                    standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
                });
                const pdf = await loadingTask.promise;
                setPdfDoc(pdf);
                setNumPages(pdf.numPages);
                canvasRefs.current = new Array(pdf.numPages).fill(null);
            } catch (error) {
                console.error("Internal PDF load failed", error);
            }
        };
        if (pdfUrl) loadPdf();
    }, [pdfUrl]);

    useEffect(() => {
        if (!pdfDoc || numPages === 0) return;

        const renderPages = async () => {
            for (let i = 1; i <= numPages; i++) {
                const canvas = canvasRefs.current[i-1];
                if (canvas) {
                    const page = await pdfDoc.getPage(i);
                    // Base scale * user zoom percentage
                    const viewport = page.getViewport({ scale: 1.2 * (zoomPercent / 100) });
                    
                    const context = canvas.getContext('2d');
                    if (context) {
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        // Keep actual rendered width so zoom controls visibly affect the PDF panel.
                        canvas.style.width = `${viewport.width}px`;
                        canvas.style.height = "auto";
                        
                        await page.render({
                            canvasContext: context,
                            viewport: viewport
                        }).promise;
                        
                        canvas.setAttribute('data-rendered', 'true');
                    }
                }
            }
        };
        renderPages();
    }, [pdfDoc, numPages, zoomPercent]);

    return (
        <div className="flex flex-col items-center bg-gray-500 py-4 gap-4 min-h-full overflow-auto">
            {Array.from({ length: numPages }, (_, i) => (
                <div key={i} className="bg-white shadow-lg" style={{ width: 'fit-content', maxWidth: 'none' }}>
                     <canvas 
                        ref={(el) => { canvasRefs.current[i] = el; }} 
                     />
                </div>
            ))}
            {numPages === 0 && <div className="text-white mt-10">Loading PDF Document...</div>}
        </div>
    );
};

type SourceTranslateData = {
  pageTranslations?: Record<number, string[]> | null;
  structuredOriginalBlocks?: Record<number, string[]> | null;
  extractedPageTexts?: { pageIndex: number; text: string }[] | null;
  onRequestPageTranslate?: () => void | Promise<void>;
};

const TwinView: React.FC<TwinViewProps & { onToggleBookmark: (id: string) => void; onUpdateNote: (id: string, note: string) => void; onSyncScroll: (percentage: number) => void; onRetranslatePage?: (pageIndex: number) => void; onLoadNextBatch?: () => void; } & SourceTranslateData> = ({ 
  segments, 
  highlightedId, 
  onHoverSegment,
  onCitationClick,
  pdfUrl,
  currentRange,
  onNavigatePage,
  onExplainSegment,
  onToggleBookmark,
  onUpdateNote,
  onSyncScroll,
  onRetranslatePage,
  onLoadNextBatch,
  pageTranslations = null,
  structuredOriginalBlocks = null,
  extractedPageTexts = null,
  onRequestPageTranslate
}) => {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);
  const [viewMode, setViewMode] = useState<'text' | 'image' | 'pdf' | 'bookmarks'>('text');
  const [leftViewMode, setLeftViewMode] = useState<'english' | 'korean' | 'twin'>('korean');
  const [pdfZoom, setPdfZoom] = useState(100);
  const [showSourceViewWindow, setShowSourceViewWindow] = useState(false);
  const [isSourceViewWindowFullscreen, setIsSourceViewWindowFullscreen] = useState(false);
  const [isTwinScrollSyncOn, setIsTwinScrollSyncOn] = useState(true);

  const figureSegments = segments.filter(s => s.type === SegmentType.FIGURE_CAPTION || s.type === SegmentType.TABLE || (s.type === SegmentType.TEXT && s.original.toLowerCase().startsWith('figure')));
  const bookmarkedSegments = segments.filter(s => s.isBookmarked);

  // Group Segments by Page Index
  const groupedSegments = useMemo(() => {
    const groups: { [key: number]: PaperSegment[] } = {};
    segments.forEach(seg => {
        const pIdx = seg.pageIndex || 1;
        if (!groups[pIdx]) groups[pIdx] = [];
        groups[pIdx].push(seg);
    });
    return groups;
  }, [segments]);

  const sortedPageKeys = Object.keys(groupedSegments).map(Number).sort((a, b) => a - b);
  const maxPageLoaded = sortedPageKeys.length > 0 ? Math.max(...sortedPageKeys) : 0;

  const openPdfInNewWindow = () => {
    if (!pdfUrl) return;
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleScroll = (source: 'left' | 'right') => {
    if (!isTwinScrollSyncOn) return;
    if (viewMode !== 'text' && viewMode !== 'pdf' && source === 'left') return;
    if (isSyncing.current) return;
    
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    isSyncing.current = true;

    if (source === 'right') {
         const scrollable = right.scrollHeight - right.clientHeight;
         const percentage = scrollable > 0 ? right.scrollTop / scrollable : 0;
         if (!isNaN(percentage)) onSyncScroll(percentage);
         const leftScrollable = left.scrollHeight - left.clientHeight;
         left.scrollTop = Math.max(0, percentage * leftScrollable);
    }

    if (source === 'left') {
      const scrollable = left.scrollHeight - left.clientHeight;
      const percentage = scrollable > 0 ? left.scrollTop / scrollable : 0;
      const rightScrollable = right.scrollHeight - right.clientHeight;
      right.scrollTop = Math.max(0, percentage * rightScrollable);
    } 

    setTimeout(() => {
      isSyncing.current = false;
    }, 50);
  };

  const getLeftSegmentContent = (seg: PaperSegment) => {
    if (leftViewMode === 'english') return seg.original;
    if (leftViewMode === 'korean') return seg.translated;
    return `[Original]\n${seg.original}\n\n[Translation]\n${seg.translated}`;
  };

  const getLeftPreviewText = () => {
    const hasPageOriginal = extractedPageTexts?.length && (structuredOriginalBlocks && Object.keys(structuredOriginalBlocks).length > 0);
    const hasPageTranslation = pageTranslations != null && Object.keys(pageTranslations).length > 0;
    const hasSegmentTranslation = segments.some((s) => (s.translated || '').trim().length > 0);

    if (leftViewMode === 'english') {
      if (hasPageOriginal && extractedPageTexts && structuredOriginalBlocks) {
        return extractedPageTexts
          .map((p) => {
            const blocks = structuredOriginalBlocks![p.pageIndex];
            const blockText = blocks?.length ? blocks.join('\n\n') : (p.text || '').trim();
            return `--- Page ${p.pageIndex} ---\n\n${blockText}`;
          })
          .join('\n\n\n');
      }
      if (segments.length === 0) return '원문이 없습니다.';
      return segments.map((s) => s.original).join('\n\n');
    }

    if (leftViewMode === 'korean') {
      if (hasPageTranslation && extractedPageTexts && pageTranslations) {
        return extractedPageTexts
          .map((p) => {
            const blocks = pageTranslations[p.pageIndex] || [];
            return `--- Page ${p.pageIndex} (번역) ---\n\n${blocks.join('\n\n')}`;
          })
          .join('\n\n\n');
      }
      if (hasSegmentTranslation) return segments.map((s) => s.translated).join('\n\n');
      return '번역이 없습니다. [원문번역] 화면에서 페이지번역을 실행하면 여기서 볼 수 있습니다.';
    }

    // 함께 보기
    if (hasPageOriginal && hasPageTranslation && extractedPageTexts && structuredOriginalBlocks && pageTranslations) {
      return extractedPageTexts
        .map((p) => {
          const origBlocks = structuredOriginalBlocks[p.pageIndex] || [];
          const transBlocks = pageTranslations[p.pageIndex] || [];
          const origText = origBlocks.length ? origBlocks.join('\n\n') : (p.text || '').trim();
          const transText = transBlocks.join('\n\n');
          return `--- Page ${p.pageIndex} ---\n\n[Original]\n${origText}\n\n[Translation]\n${transText}`;
        })
        .join('\n\n---\n\n');
    }
    if (segments.length === 0) return '번역 결과가 아직 없습니다.';
    return segments.map((s) => `[Original]\n${s.original}\n\n[Translation]\n${s.translated}`).join('\n\n---\n\n');
  };

  const handleLeftViewMode = (mode: 'english' | 'korean' | 'twin') => {
    if (mode === 'korean') {
      const hasPageTranslation = pageTranslations != null && Object.keys(pageTranslations).length > 0;
      const hasSegmentTranslation = segments.some((s) => (s.translated || '').trim().length > 0);
      if (!hasPageTranslation && !hasSegmentTranslation && segments.length > 0 && onRequestPageTranslate && window.confirm('번역이 없습니다. 지금 [AI페이지번역]을 실행할까요?')) {
        onRequestPageTranslate();
      }
    }
    setLeftViewMode(mode);
  };

  const renderSegmentList = (isKorean: boolean) => {
      return (
          <div className={`p-6 font-sans ${!isKorean ? 'space-y-4' : ''}`}>
              {sortedPageKeys.map(pageIdx => (
                  <div key={pageIdx} id={`page-container-${pageIdx}`} className="mb-10 scroll-mt-4">
                      <div className="flex items-center gap-3 mb-4 pb-2 border-b border-gray-200">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-2 py-1 rounded">
                              Page {pageIdx}
                          </span>
                          {isKorean && onRetranslatePage && (
                              <button 
                                  onClick={() => onRetranslatePage(pageIdx)}
                                  className="text-xs flex items-center gap-1 text-primary-600 hover:text-primary-800 hover:bg-primary-50 px-2 py-1 rounded transition-colors"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                  </svg>
                                  Re-analyze Page
                              </button>
                          )}
                      </div>
                      {groupedSegments[pageIdx].map(seg => (
                        <div key={`wrap-${isKorean ? 'trans' : 'orig'}-${seg.id}`} className={!isKorean ? 'rounded-lg border border-gray-200 bg-gray-50/50 p-4 mb-4' : ''}>
                        <SegmentBlock
                            key={`${isKorean ? 'trans' : 'orig'}-${seg.id}`}
                            segment={seg}
                            content={isKorean ? seg.translated : seg.original}
                            isKorean={isKorean}
                            highlighted={highlightedId === seg.id}
                            onHover={() => onHoverSegment(seg.id)}
                            onCitationClick={onCitationClick}
                            onExplain={onExplainSegment}
                            onToggleBookmark={onToggleBookmark}
                            onUpdateNote={onUpdateNote}
                        />
                        </div>
                      ))}
                  </div>
              ))}
              
              {/* Load Next Batch Button */}
              {onLoadNextBatch && (
                  <div className="py-10 text-center">
                       <button 
                          onClick={onLoadNextBatch}
                          className="px-6 py-3 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 shadow-sm transition-all hover:scale-105 active:scale-95 flex items-center gap-2 mx-auto"
                        >
                            <span>Load Next 1 Page (Page {maxPageLoaded + 1})</span>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                       </button>
                  </div>
              )}
          </div>
      );
  };

  return (
    <div className="flex flex-col h-full border-t border-gray-200">
      <div className="flex-1 flex overflow-hidden relative">
        <div className="w-1/2 flex flex-col border-r border-gray-200 bg-white relative">
          <div className="h-12 flex-none px-4 flex items-center justify-between border-b border-gray-100 bg-white z-10">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setViewMode('text');
                  setIsSourceViewWindowFullscreen(false);
                  setShowSourceViewWindow(true);
                }}
                className={`font-sans text-xs uppercase tracking-wider transition-colors px-2 py-1 rounded border ${
                  viewMode === 'text'
                    ? 'bg-white text-gray-800 shadow-sm border-gray-300'
                    : 'text-gray-500 hover:text-gray-800 border-transparent'
                }`}
                title="원문 텍스트 보기"
              >
                원문 text
              </button>
            </div>
            <div className="flex items-center gap-2">
               <div className="flex bg-gray-100 rounded p-0.5">
                <button onClick={() => setViewMode('text')} className={`px-3 py-1 text-xs font-medium rounded ${viewMode === 'text' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>Text</button>
                <button onClick={() => setViewMode('image')} className={`px-3 py-1 text-xs font-medium rounded ${viewMode === 'image' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>Figs/Tables</button>
                <button onClick={() => setViewMode('bookmarks')} className={`px-3 py-1 text-xs font-medium rounded ${viewMode === 'bookmarks' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>★</button>
                <button onClick={() => setViewMode('pdf')} className={`px-3 py-1 text-xs font-medium rounded ${viewMode === 'pdf' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>PDF</button>
                <button onClick={() => setPdfZoom((z) => Math.max(70, z - 10))} disabled={viewMode !== 'pdf'} className="px-2 py-1 text-xs font-medium rounded text-gray-500 hover:text-gray-800 disabled:opacity-40">-</button>
                <span className="px-1 text-[11px] text-gray-500 min-w-[40px] text-center">{pdfZoom}%</span>
                <button onClick={() => setPdfZoom((z) => Math.min(180, z + 10))} disabled={viewMode !== 'pdf'} className="px-2 py-1 text-xs font-medium rounded text-gray-500 hover:text-gray-800 disabled:opacity-40">+</button>
                <button onClick={openPdfInNewWindow} disabled={!pdfUrl || viewMode !== 'pdf'} className="px-3 py-1 text-xs font-medium rounded text-gray-500 hover:text-gray-800 disabled:opacity-40">새창 PDF</button>
              </div>
            </div>
          </div>

          <div 
            ref={leftRef}
            onScroll={() => handleScroll('left')}
            className="flex-1 overflow-y-auto"
          >
            {viewMode === 'text' && renderSegmentList(false)}

            {viewMode === 'image' && <FigureList figures={figureSegments} onExplain={onExplainSegment} />}

            {viewMode === 'bookmarks' && (
                <div className="p-6">
                    <div className="mb-4 text-sm text-gray-500">Bookmarked sections appear here.</div>
                    {bookmarkedSegments.length === 0 && <p className="text-center text-gray-400">No bookmarks yet.</p>}
                    {bookmarkedSegments.map(seg => (
                        <div key={seg.id} className="mb-4 border border-yellow-200 bg-yellow-50/30 rounded p-3">
                            <div className="text-xs text-gray-400 mb-1 uppercase">Original</div>
                            <p className="text-sm text-gray-800 mb-2 font-serif">{seg.original}</p>
                            <div className="text-xs text-gray-400 mb-1 uppercase">Translation</div>
                            <p className="text-sm text-gray-800">{seg.translated}</p>
                        </div>
                    ))}
                </div>
            )}

            {viewMode === 'pdf' && (
              <div className="w-full h-full bg-gray-200">
                {pdfUrl ? (
                  <InternalPdfRenderer pdfUrl={pdfUrl} zoomPercent={pdfZoom} />
                ) : <div className="p-8 text-center text-gray-400">PDF not available</div>}
              </div>
            )}
          </div>

          {showSourceViewWindow && viewMode === 'text' && (
            <div
              className={`fixed z-40 bg-white border border-gray-200 shadow-xl flex flex-col ${
                isSourceViewWindowFullscreen
                  ? 'inset-4 rounded-lg'
                  : 'left-4 top-24 w-[360px] h-[320px] min-w-[280px] min-h-[220px] max-w-[70vw] max-h-[70vh] rounded-lg resize overflow-auto'
              }`}
            >
              <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                <span className="text-xs font-bold text-gray-600">원문 보기 설정</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsTwinScrollSyncOn((prev) => !prev)}
                    className={`text-xs px-2 py-1 rounded border ${isTwinScrollSyncOn ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-gray-500 border-gray-300'}`}
                    title="원문·번역 창 스크롤 동기화"
                  >
                    스크롤 동기화 {isTwinScrollSyncOn ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => setIsSourceViewWindowFullscreen((prev) => !prev)}
                    className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                  >
                    {isSourceViewWindowFullscreen ? '기본크기' : '전체화면'}
                  </button>
                  <button
                    onClick={() => {
                      setIsSourceViewWindowFullscreen(false);
                      setShowSourceViewWindow(false);
                    }}
                    className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                  >
                    닫기
                  </button>
                </div>
              </div>
              <div className="p-3 flex-1 min-h-0 flex flex-col">
                <div className="flex gap-2 mb-2">
                  <button onClick={() => handleLeftViewMode('english')} className={`text-xs px-2.5 py-1 rounded border ${leftViewMode === 'english' ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-gray-500 border-gray-300'}`}>영어만</button>
                  <button onClick={() => handleLeftViewMode('korean')} className={`text-xs px-2.5 py-1 rounded border ${leftViewMode === 'korean' ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-gray-500 border-gray-300'}`}>한국어만</button>
                  <button onClick={() => handleLeftViewMode('twin')} className={`text-xs px-2.5 py-1 rounded border ${leftViewMode === 'twin' ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-gray-500 border-gray-300'}`}>함께 보기</button>
                </div>
                <div className="p-3 bg-gray-50 rounded border border-gray-200 text-xs font-mono flex-1 min-h-0 overflow-y-auto whitespace-pre-wrap">
                  {getLeftPreviewText()}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="w-1/2 flex flex-col bg-slate-50 relative">
          <div className="h-12 flex-none px-4 flex items-center justify-between border-b border-gray-200 bg-slate-50 z-10">
             <span className="font-sans text-xs uppercase tracking-wider text-gray-500">Translated Twin</span>
          </div>

          <div 
            ref={rightRef}
            onScroll={() => handleScroll('right')}
            className="flex-1 overflow-y-auto font-sans"
          >
            {renderSegmentList(true)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TwinView;
