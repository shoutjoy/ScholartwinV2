
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TranslationTone, PaperSegment, VocabularyItem, ConclusionSummary, PaperMetadata, User, ExtractedFigure, PaperAnalysisResult, ExtractionMethod } from './types';
import { fileToBase64, downloadText, printTranslatedPdf, renderPdfPagesToImages, getPdfPageCount, extractTextFromPdfPages, type ExtractedPageText } from './services/fileHelper';
import { getStoredSettings, analyzePaperMetadata, analyzePageContent, analyzePageContentFromText, extractVocabulary, generateConclusion, findReferenceDetails, explainBlockContent, generatePresentationScript } from './services/geminiService';
import { authService } from './services/authService';
import FileUpload from './components/FileUpload';
import TwinView from './components/TwinView';
import ToolsPanel from './components/ToolsPanel';
import AuthModal from './components/AuthModal';
import AdminDashboard from './components/AdminDashboard';
import SettingsModal from './components/SettingsModal';
import ChatInterface from './components/ChatInterface';
import ExternalPdfViewer from './components/ExternalPdfViewer';
import SidebarNav from './components/SidebarNav';

const App: React.FC = () => {
  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [pendingUserCount, setPendingUserCount] = useState(0);

  // App State
  const [segments, setSegments] = useState<PaperSegment[]>([]);
  const [metadata, setMetadata] = useState<PaperMetadata | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  
  const [tone, setTone] = useState<TranslationTone>(TranslationTone.ACADEMIC);
  const [pageRange, setPageRange] = useState<string>('');
  const [currentActiveRange, setCurrentActiveRange] = useState<string>(''); 
  const [lastProcessedPage, setLastProcessedPage] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState<string>(''); 
  
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [conclusion, setConclusion] = useState<ConclusionSummary | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [showPdfMenu, setShowPdfMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [pdfFontSize, setPdfFontSize] = useState<number>(100);

  // UI State
  const [showPdfWindow, setShowPdfWindow] = useState(false);
  const [scrollSyncPercentage, setScrollSyncPercentage] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  /** Auto-extracted text from PDF (by page, with markers). Filled when file is uploaded. */
  const [extractedPageTexts, setExtractedPageTexts] = useState<ExtractedPageText[] | null>(null);
  const [extractingText, setExtractingText] = useState(false);
  const [extractTextError, setExtractTextError] = useState<string | null>(null);
  /** Tab for preview area when no segments yet: 'pdf' | 'text' */
  const [previewTab, setPreviewTab] = useState<'pdf' | 'text'>('pdf');

  const abortRef = useRef(false);

  // Computed state for sidebar
  const processedPageIndices = useMemo(() => {
      const indices = new Set(segments.map(s => s.pageIndex));
      return Array.from(indices).sort((a, b) => a - b);
  }, [segments]);

  // Init Auth
  useEffect(() => {
    const user = authService.getCurrentUser();
    if (user) {
        setCurrentUser(user);
        if (user.isAdmin) {
            setPendingUserCount(authService.getPendingUserCount());
        }
    }
  }, []);

  useEffect(() => {
    if (selectedFile) {
      const url = URL.createObjectURL(selectedFile);
      setPdfUrl(url);
      
      // Fetch Total Page Count immediately
      getPdfPageCount(selectedFile).then(count => {
          setTotalPages(count);
      });

      // Start text extraction in background (for PDF / Text tabs)
      setExtractingText(true);
      setExtractTextError(null);
      setExtractedPageTexts(null);
      extractTextFromPdfPages(selectedFile, 9999)
        .then(pages => {
          setExtractedPageTexts(pages);
          setExtractTextError(null);
        })
        .catch(err => {
          console.warn('Auto text extraction failed', err);
          setExtractTextError(err?.message || 'Failed to extract text.');
          setExtractedPageTexts(null);
        })
        .finally(() => setExtractingText(false));

      return () => URL.revokeObjectURL(url);
    } else {
      setPdfUrl(null);
      setTotalPages(0);
      setExtractedPageTexts(null);
      setExtractingText(false);
      setExtractTextError(null);
      setPreviewTab('pdf');
    }
  }, [selectedFile]);

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    if (user.isAdmin) {
        setPendingUserCount(authService.getPendingUserCount());
    }
  };

  const handleLogout = () => {
    authService.logout();
    setCurrentUser(null);
    setShowAdmin(false);
    handleRemoveFile();
  };

  // --- Core App Logic ---
  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setSegments([]); 
    setMetadata(null);
    setVocabulary([]);
    setConclusion(null);
    setPageRange('');
    setCurrentActiveRange('');
    setLastProcessedPage(0);
    setTotalPages(0);
    setShowPdfWindow(false);
  };

  const handleCancelProcessing = () => {
      abortRef.current = true;
  };

  const executeTranslation = async (startPage: number, endPage: number, isAppend: boolean = false, forceExtractionMethod?: ExtractionMethod) => {
    if (!selectedFile) return;
    const settings = getStoredSettings();
    const extractionMethod = forceExtractionMethod ?? settings.extractionMethod;
    const usePdfTextLayer = extractionMethod === 'pdfTextLayer';

    try {
      setIsProcessing(true);
      abortRef.current = false;
      setProgress(5); 
      setProcessingStatus(usePdfTextLayer ? 'Extracting text from PDF...' : 'Preparing PDF...');
      
      if (!isAppend) setSegments([]); 

      if (usePdfTextLayer) {
        // --- PDF text layer extraction path (default) ---
        let extractedPages;
        try {
          extractedPages = await extractTextFromPdfPages(selectedFile, endPage);
          const total = await getPdfPageCount(selectedFile);
          setTotalPages(prev => Math.max(prev, total));
        } catch (pdfError: any) {
          console.error("PDF text extraction failed", pdfError);
          alert(`Failed to extract text from PDF.\n${pdfError.message}\n\nTry "AI 이미지 분석" in Settings if the PDF has no text layer.`);
          setIsProcessing(false);
          return;
        }

        if (abortRef.current) { setIsProcessing(false); return; }

        const pagesToProcess = extractedPages.filter(p => p.pageIndex >= startPage && p.pageIndex <= endPage);
        if (pagesToProcess.length === 0) {
          alert("No pages found for this range.");
          setIsProcessing(false);
          return;
        }

        if (!metadata && !isAppend) {
          setProgress(10);
          setProcessingStatus('Analyzing Metadata...');
          try {
            const firstPageImg = await renderPdfPagesToImages(selectedFile, 1);
            if (firstPageImg.length > 0) {
              const meta = await analyzePaperMetadata(firstPageImg[0].base64);
              setMetadata(meta);
            } else {
              setMetadata({ title: selectedFile.name, authors: [], year: "", journal: "" });
            }
          } catch (metaError) {
            setMetadata({ title: selectedFile.name, authors: [], year: "", journal: "" });
          }
        }

        if (abortRef.current) { setIsProcessing(false); return; }

        for (let i = 0; i < pagesToProcess.length; i++) {
          if (abortRef.current) break;
          const pageData = pagesToProcess[i];
          const currentProgress = 10 + Math.round(((i + 1) / pagesToProcess.length) * 80);
          setProgress(currentProgress);
          setProcessingStatus(`Processing Page ${pageData.pageIndex} of ${endPage}...`);

          const pageSegments = await analyzePageContentFromText(pageData.textWithPageMarker, pageData.pageIndex, tone);
          if (abortRef.current) break;

          setSegments(prev => {
            const filtered = prev.filter(s => s.pageIndex !== pageData.pageIndex);
            return [...filtered, ...pageSegments];
          });
          setLastProcessedPage(prev => Math.max(prev, pageData.pageIndex));
        }

        const lastPage = pagesToProcess.length > 0 ? pagesToProcess[pagesToProcess.length - 1].pageIndex : startPage;
        const newRangeStr = `${startPage}-${lastPage}`;
        setCurrentActiveRange(prev => isAppend ? (prev ? `${prev}, ${newRangeStr}` : newRangeStr) : newRangeStr);
        setProgress(100);
      } else {
        // --- AI vision extraction path (optional) ---
        let pageImages;
        try {
          pageImages = await renderPdfPagesToImages(selectedFile, endPage);
          setTotalPages(prev => Math.max(prev, pageImages.length));
        } catch (pdfError: any) {
          console.error("PDF Parsing failed", pdfError);
          alert(`Failed to read the PDF file. \nError: ${pdfError.message}`);
          setIsProcessing(false);
          return;
        }

        if (abortRef.current) { setIsProcessing(false); return; }

        const pagesToProcess = pageImages.filter(p => p.pageIndex >= startPage && p.pageIndex <= endPage);
        if (pagesToProcess.length === 0) {
          alert("No pages found for this range.");
          setIsProcessing(false);
          return;
        }

        if (!metadata && !isAppend) {
          setProgress(10);
          setProcessingStatus('Analyzing Metadata...');
          try {
            const meta = await analyzePaperMetadata(pageImages[0].base64);
            setMetadata(meta);
          } catch (metaError) {
            setMetadata({ title: selectedFile.name, authors: [], year: "", journal: "" });
          }
        }

        if (abortRef.current) { setIsProcessing(false); return; }

        for (let i = 0; i < pagesToProcess.length; i++) {
          if (abortRef.current) break;
          const pageImg = pagesToProcess[i];
          const currentProgress = 10 + Math.round(((i + 1) / pagesToProcess.length) * 80);
          setProgress(currentProgress);
          setProcessingStatus(`Processing Page ${pageImg.pageIndex} of ${endPage}...`);

          const pageSegments = await analyzePageContent(pageImg.base64, pageImg.pageIndex - 1, tone);
          if (abortRef.current) break;

          setSegments(prev => {
            const filtered = prev.filter(s => s.pageIndex !== pageImg.pageIndex);
            return [...filtered, ...pageSegments];
          });
          setLastProcessedPage(prev => Math.max(prev, pageImg.pageIndex));
        }

        const lastPage = pagesToProcess.length > 0 ? pagesToProcess[pagesToProcess.length - 1].pageIndex : startPage;
        const newRangeStr = `${startPage}-${lastPage}`;
        setCurrentActiveRange(prev => isAppend ? (prev ? `${prev}, ${newRangeStr}` : newRangeStr) : newRangeStr);
        setProgress(100);
      }

    } catch (error: any) {
      console.error("Translation Error:", error);
      alert("Failed to process PDF.");
      setProgress(0);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleRetranslatePage = async (pageIndex: number) => {
    await executeTranslation(pageIndex, pageIndex, true);
  };

  const handleTranslate = async (isFull: boolean, forceExtractionMethod?: ExtractionMethod) => {
    if (!selectedFile) return;
    
    // IMPORTANT: Open the window immediately on user click to prevent browser popup blocking
    setShowPdfWindow(true);
    
    if (isFull) {
        await executeTranslation(1, totalPages || 9999, false, forceExtractionMethod);
    } else {
        let start = 1;
        let end = 2; // Default 2 pages
        
        if (pageRange.trim()) {
             const parts = pageRange.split('-').map(p => parseInt(p.trim()));
             if (!isNaN(parts[0])) start = parts[0];
             if (parts.length > 1 && !isNaN(parts[1])) end = parts[1];
             else end = start;
        }

        await executeTranslation(start, end, false, forceExtractionMethod);
    }
  };
  
  const handleLoadNextBatch = () => {
      const nextStart = lastProcessedPage + 1;
      const nextEnd = nextStart + 1; // Load 2 pages
      executeTranslation(nextStart, nextEnd, true);
  };

  const handleSidebarPageClick = (pageIndex: number, isProcessed: boolean) => {
      if (isProcessed) {
          const el = document.getElementById(`page-container-${pageIndex}`);
          if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
      } else {
          if (confirm(`Translate Page ${pageIndex} now?`)) {
              executeTranslation(pageIndex, pageIndex, true);
          }
      }
  };

  const handleSidebarHeadingClick = (segmentId: string) => {
      const el = document.getElementById(`trans-${segmentId}`); 
      if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setHighlightedId(segmentId);
          setTimeout(() => setHighlightedId(null), 2000);
      }
  };

  const handlePageNavigation = (direction: 'next' | 'prev') => {
  };

  const handleResetTranslation = () => {
    setSegments([]); 
    setCurrentActiveRange('');
    setLastProcessedPage(0);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setSegments([]);
    setShowPdfWindow(false);
  };

  const handleGenerateVocab = async () => {
    if (segments.length === 0) return;
    setIsProcessing(true);
    setProcessingStatus('Extracting Vocabulary...');
    try {
      const vocab = await extractVocabulary(segments);
      setVocabulary(vocab);
    } catch (e) {
      alert("Failed to generate vocabulary.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleUpdateVocabItem = (index: number, item: VocabularyItem) => {
    const newVocab = [...vocabulary];
    newVocab[index] = item;
    setVocabulary(newVocab);
  };

  const handleGenerateConclusion = async () => {
    if (segments.length === 0) return;
    setIsProcessing(true);
    setProcessingStatus('Summarizing Conclusion...');
    try {
      const summary = await generateConclusion(segments);
      setConclusion(summary);
    } catch (e) {
      alert("Failed to generate conclusion.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleGeneratePPT = async () => {
      if (segments.length === 0) return "";
      try {
          return await generatePresentationScript(segments);
      } catch (e) {
          alert("Failed to generate PPT script.");
          return "";
      }
  };

  const handleExplainSegment = async (segmentId: string, userPrompt?: string) => {
    const segmentIndex = segments.findIndex(s => s.id === segmentId);
    if (segmentIndex === -1) return;
    
    if (!userPrompt && (segments[segmentIndex].explanation || segments[segmentIndex].explanationEn)) return;

    const loadingSegments = [...segments];
    loadingSegments[segmentIndex] = { ...loadingSegments[segmentIndex], isExplaining: true };
    setSegments(loadingSegments);

    const seg = segments[segmentIndex];
    try {
      const result = await explainBlockContent(seg.original, seg.translated, userPrompt);
      const newSegments = [...segments];
      newSegments[segmentIndex] = { 
        ...seg, 
        explanation: result.korean, 
        explanationEn: result.english,
        isExplaining: false 
      };
      setSegments(newSegments);
    } catch (e) {
      const errorSegments = [...segments];
      errorSegments[segmentIndex] = { ...errorSegments[segmentIndex], isExplaining: false };
      setSegments(errorSegments);
      alert("Failed to explain content.");
    }
  };

  const handleToggleBookmark = (id: string) => {
      setSegments(prev => prev.map(s => s.id === id ? { ...s, isBookmarked: !s.isBookmarked } : s));
  };

  const handleUpdateNote = (id: string, note: string) => {
      setSegments(prev => prev.map(s => s.id === id ? { ...s, userNote: note } : s));
  };

  const handleDownloadTxt = (type: 'english' | 'korean' | 'twin' | 'notebooklm') => {
    if (segments.length === 0) return;
    let content = "";
    if (type === 'english') {
      content = segments.map(s => s.original + (s.userNote ? `\n[NOTE: ${s.userNote}]` : '')).join('\n\n');
    } else if (type === 'korean') {
      content = segments.map(s => s.translated + (s.userNote ? `\n[NOTE: ${s.userNote}]` : '')).join('\n\n');
    } else if (type === 'notebooklm') {
      content = segments.map(s => `## ${s.original}\n${s.translated}\n`).join('\n\n');
    } else {
      content = segments.map(s => `[Original]\n${s.original}\n\n[Translation]\n${s.translated}${s.userNote ? `\n[NOTE: ${s.userNote}]` : ''}\n\n---`).join('\n');
    }
    downloadText(`paper_${type}.txt`, content);
    setShowDownloadMenu(false);
  };

  const handleDownloadOriginalPdf = () => {
    if (pdfUrl) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = selectedFile?.name || 'document.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setShowPdfMenu(false);
  };

  const handleDownloadTranslatedPdf = () => {
    if (segments.length === 0 || !metadata) return;
    printTranslatedPdf(metadata.title, segments, pdfFontSize);
    setShowPdfMenu(false);
  };

  const handleCitationClick = async (citation: string) => {
    const fullText = segments.map(s => s.original).join("\n");
    try {
        const details = await findReferenceDetails(citation, fullText);
        alert(`Reference Found:\n\n${details}`);
    } catch (e) {
        alert(`Could not resolve details for ${citation}`);
    }
  };

  const getApaCitation = () => {
    if (!metadata) return "";
    const authors = metadata.authors.join(", ");
    return `${authors} (${metadata.year}). ${metadata.title}. ${metadata.journal}, ${metadata.volumeIssue || ""}${metadata.pages ? `, ${metadata.pages}` : ""}. ${metadata.doi ? `https://doi.org/${metadata.doi}` : ""}`;
  };

  const getMlaCitation = () => {
    if (!metadata) return "";
    const authors = metadata.authors.length > 0 ? metadata.authors[0] + (metadata.authors.length > 1 ? " et al." : "") : "Unknown";
    return `${authors}. "${metadata.title}." ${metadata.journal}, ${metadata.volumeIssue ? `vol. ${metadata.volumeIssue}, ` : ""}${metadata.year}, ${metadata.pages ? `pp. ${metadata.pages}` : ""}.`;
  };

  const copyToClipboard = (text: string) => {
    if (text) {
      navigator.clipboard.writeText(text);
      alert("Citation Copied!");
    }
  };

  if (!currentUser) {
    return <AuthModal onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between z-20 shadow-sm flex-none h-16">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.location.reload()}>
           <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
             S
           </div>
           <h1 className="text-xl font-bold text-gray-800 tracking-tight">ScholarTwin <span className="text-primary-500 font-light">AI</span></h1>
        </div>

        <div className="flex items-center gap-4">
          {segments.length > 0 ? (
            <div className="flex items-center gap-2">
              <button 
                onClick={handleResetTranslation}
                className="text-sm font-medium text-gray-500 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors mr-2 border border-gray-200"
              >
                ← Back
              </button>
              
              <button 
                onClick={() => setShowTools(true)}
                className="text-sm font-medium text-gray-600 hover:text-primary-600 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                disabled={isProcessing}
              >
                Study Assistant
              </button>
              
              <div className="flex bg-gray-100 rounded-lg p-1 gap-1 relative">
                <div className="relative">
                  <button 
                    onClick={() => setShowPdfMenu(!showPdfMenu)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-white hover:shadow-sm rounded transition-all flex items-center gap-1"
                  >
                    PDF ▼
                  </button>
                  {showPdfMenu && (
                    <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden z-50">
                      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
                         <label className="text-[10px] uppercase font-bold text-gray-500 block mb-1">PDF Font Size</label>
                         <div className="flex items-center justify-between bg-white border border-gray-200 rounded">
                           <button onClick={() => setPdfFontSize(Math.max(50, pdfFontSize - 10))} className="px-2 py-1 text-gray-500 hover:bg-gray-100 font-bold">-</button>
                           <span className="text-xs font-medium text-gray-700">{pdfFontSize}%</span>
                           <button onClick={() => setPdfFontSize(Math.min(200, pdfFontSize + 10))} className="px-2 py-1 text-gray-500 hover:bg-gray-100 font-bold">+</button>
                         </div>
                      </div>
                      <button 
                        onClick={() => { setShowPdfWindow(true); setShowPdfMenu(false); }}
                        className="w-full text-left px-4 py-3 text-xs hover:bg-gray-50 flex items-center gap-2 text-indigo-600 font-medium"
                      >
                        <span>❐</span> PDF (New Window)
                      </button>
                      <button onClick={handleDownloadOriginalPdf} className="w-full text-left px-4 py-3 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700">
                        <span>📄</span> Download Original (PDF)
                      </button>
                      <button onClick={handleDownloadTranslatedPdf} className="w-full text-left px-4 py-3 text-xs hover:bg-gray-50 flex items-center gap-2 border-t border-gray-50 text-gray-700">
                        <span>🌏</span> Download Translated (PDF)
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="relative">
                  <button 
                    onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-white hover:shadow-sm rounded transition-all flex items-center gap-1"
                  >
                    TXT ▼
                  </button>
                  {showDownloadMenu && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden z-50">
                      <button onClick={() => handleDownloadTxt('english')} className="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 text-gray-700">English Only</button>
                      <button onClick={() => handleDownloadTxt('korean')} className="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 text-gray-700">Korean Only</button>
                      <button onClick={() => handleDownloadTxt('twin')} className="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 text-gray-700">Twin View</button>
                      <button onClick={() => handleDownloadTxt('notebooklm')} className="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 text-indigo-700 bg-indigo-50 font-bold border-t border-gray-100">Prepare for NotebookLM</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 mr-2 flex items-center gap-2">
               <span>Welcome, <strong>{currentUser.name}</strong></span>
               {currentUser.isPaid && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200">Premium</span>}
            </div>
          )}
          
          <div className="flex items-center gap-2">
            {segments.length > 0 && (
                <button
                onClick={() => setShowChat(!showChat)}
                title="Chat with Paper"
                className={`p-2 rounded-full transition-colors ${showChat ? 'bg-indigo-100 text-indigo-600' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
                </button>
            )}
            <button onClick={() => setShowSettings(true)} title="AI Settings" className="text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100 transition-colors">
               <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                 <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" />
                 <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
               </svg>
            </button>
          </div>

          {currentUser.isAdmin && (
             <div className="relative">
                 <button onClick={() => setShowAdmin(true)} title="Admin Dashboard" className="text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100 transition-colors">
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                     <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                   </svg>
                 </button>
                 {pendingUserCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center animate-pulse">{pendingUserCount}</span>}
             </div>
          )}
          <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1">Logout</button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative flex flex-col overflow-hidden justify-center">
        {metadata && segments.length > 0 && (
          <div className="bg-white border-b border-gray-200 px-6 py-3 text-xs text-gray-500 shadow-sm z-10 flex-none space-y-2">
             <div className="flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <span className="font-bold text-gray-700 inline-block w-10">APA:</span> 
                  <span className="font-serif text-gray-600">{getApaCitation()}</span>
                </div>
                <button onClick={() => copyToClipboard(getApaCitation())} className="text-[10px] px-2 py-0.5 bg-gray-100 border border-gray-300 rounded text-gray-600 hover:bg-gray-200 hover:text-gray-800 transition-colors">Copy APA</button>
             </div>
             <div className="flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <span className="font-bold text-gray-700 inline-block w-10">MLA:</span> 
                  <span className="font-serif text-gray-600">{getMlaCitation()}</span>
                </div>
                <button onClick={() => copyToClipboard(getMlaCitation())} className="text-[10px] px-2 py-0.5 bg-gray-100 border border-gray-300 rounded text-gray-600 hover:bg-gray-200 hover:text-gray-800 transition-colors">Copy MLA</button>
             </div>
          </div>
        )}

        {!selectedFile ? (
          <div className="w-full flex-1 flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
            <div className="max-w-2xl w-full">
              <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />
              <div className="mt-8 text-center text-gray-400 text-sm">
                <p>Supported: PDF Files (Research Papers, Journals)</p>
                <p>Features: Translation, Twin View, Vocab Extraction, Scholar Grounding</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex w-full max-w-7xl mx-auto shadow-xl bg-white overflow-hidden h-[calc(100vh-80px)] rounded-xl border border-gray-200">
            {segments.length === 0 ? (
              <div className="flex w-full h-full">
                  <div className="w-1/2 bg-slate-100 border-r border-gray-200 hidden md:flex flex-col relative group">
                      {/* Tabs: PDF | Text (원문 추출) */}
                      <div className="flex-shrink-0 flex border-b border-gray-200 bg-white">
                        <button
                          onClick={() => setPreviewTab('pdf')}
                          className={`px-4 py-3 text-sm font-medium transition-colors ${previewTab === 'pdf' ? 'bg-slate-100 text-gray-900 border-b-2 border-primary-500 -mb-px' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                          PDF
                        </button>
                        <button
                          onClick={() => setPreviewTab('text')}
                          className={`px-4 py-3 text-sm font-medium transition-colors flex items-center gap-1 ${previewTab === 'text' ? 'bg-slate-100 text-gray-900 border-b-2 border-primary-500 -mb-px' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                          Text (원문 추출)
                          {extractingText && <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
                        </button>
                      </div>
                      {/* Tab content */}
                      <div className="flex-1 min-h-0 relative">
                      {previewTab === 'pdf' ? (
                        <>
                      {showPdfWindow ? (
                          <div className="flex flex-col items-center justify-center h-full p-10 text-center bg-gray-200/50">
                             <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200 flex flex-col items-center animate-in fade-in zoom-in-95">
                                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-indigo-500 mb-3">
                                   <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                 </svg>
                                 <h3 className="font-bold text-gray-800 text-lg">PDF is open in a separate window</h3>
                                 <p className="text-gray-500 text-sm mt-1 mb-4">The PDF preview is synced with this dashboard.</p>
                                 <button 
                                   onClick={() => setShowPdfWindow(false)}
                                   className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors border border-gray-300"
                                 >
                                   Bring PDF Back Here
                                 </button>
                             </div>
                          </div>
                      ) : (
                          <>
                             {pdfUrl && <object data={`${pdfUrl}#toolbar=0&navpanes=0`} type="application/pdf" className="w-full h-full"><div className="flex flex-col items-center justify-center h-full text-gray-400 p-10 text-center"><p>Preview not available in this browser.</p></div></object>}
                             <div className="absolute top-4 left-4 bg-black/50 backdrop-blur text-white text-xs px-2 py-1 rounded pointer-events-none">PDF Preview</div>
                             
                             <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                <button 
                                   onClick={() => setShowPdfWindow(true)}
                                   className="bg-white text-gray-800 px-5 py-3 rounded-full shadow-lg font-bold flex items-center gap-2 pointer-events-auto hover:scale-105 transition-transform"
                                >
                                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-indigo-600">
                                     <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                   </svg>
                                   Open Synced PDF Window
                                </button>
                             </div>
                          </>
                      )}
                        </>
                      ) : (
                        <div className="absolute inset-0 flex flex-col bg-white overflow-hidden">
                          {extractingText ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-gray-500">
                              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-3" />
                              <p className="text-sm font-medium">원문 추출 중...</p>
                              <p className="text-xs mt-1">PDF 텍스트 레이어에서 페이지별로 추출합니다.</p>
                            </div>
                          ) : extractTextError ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                              <p className="text-sm text-amber-700 font-medium">추출할 수 없습니다</p>
                              <p className="text-xs text-gray-500 mt-1">{extractTextError}</p>
                              <p className="text-xs text-gray-400 mt-2">설정에서 &quot;AI 이미지 분석&quot;을 사용하거나 원문 추출 버튼을 이용하세요.</p>
                            </div>
                          ) : extractedPageTexts && extractedPageTexts.length > 0 ? (
                            <div className="flex-1 overflow-y-auto p-4">
                              <pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
                                {extractedPageTexts.map(p => p.textWithPageMarker).join('')}
                              </pre>
                            </div>
                          ) : (
                            <div className="flex-1 flex items-center justify-center p-8 text-gray-400 text-sm">
                              텍스트가 없거나 추출 결과가 비어 있습니다.
                            </div>
                          )}
                        </div>
                      )}
                      </div>
                  </div>
                  <div className="w-full md:w-1/2 bg-white flex flex-col overflow-y-auto">
                       <div className="flex-1 flex flex-col justify-center p-8 md:p-12 max-w-lg mx-auto w-full">
                            <div className="text-center mb-8">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-50 text-red-500 mb-4 shadow-sm">
                                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                                </div>
                                <h2 className="text-xl font-bold text-gray-900 line-clamp-2" title={selectedFile.name}>{selectedFile.name}</h2>
                                <p className="text-sm text-gray-500 mt-1">
                                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB • {totalPages > 0 ? `${totalPages} Pages` : 'Loading...'}
                                </p>
                            </div>

                            <div className="space-y-6">
                                <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Translation Style</label>
                                  <div className="grid grid-cols-2 gap-3">
                                    <button onClick={() => setTone(TranslationTone.ACADEMIC)} className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all flex flex-col items-center gap-1 ${tone === TranslationTone.ACADEMIC ? 'border-primary-500 bg-primary-50 text-primary-700 ring-1 ring-primary-500' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-600'}`}><span>🎓 Academic</span><span className="text-[10px] opacity-70">Formal (~이다)</span></button>
                                    <button onClick={() => setTone(TranslationTone.EXPLANATORY)} className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all flex flex-col items-center gap-1 ${tone === TranslationTone.EXPLANATORY ? 'border-primary-500 bg-primary-50 text-primary-700 ring-1 ring-primary-500' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-600'}`}><span>🗣️ Explanatory</span><span className="text-[10px] opacity-70">Easy (~해요)</span></button>
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Extraction Range</label>
                                  <div className="space-y-3">
                                      <button onClick={() => handleTranslate(true)} disabled={isProcessing} className="w-full py-4 bg-gray-900 hover:bg-black text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed">
                                         {isProcessing ? <>Processing...</> : <><span>원문 추출 (전체)</span><svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg></>}
                                       </button>
                                       <button onClick={() => handleTranslate(true, 'aiVision')} disabled={isProcessing} className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl border border-gray-300 transition-all flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed">
                                         {isProcessing ? <>Processing...</> : <><span>인공지능 추출 (전체)</span></>}
                                       </button>
                                       <div className="relative">
                                          <div className="absolute inset-0 flex items-center" aria-hidden="true"><div className="w-full border-t border-gray-200"></div></div>
                                          <div className="relative flex justify-center"><span className="px-2 bg-white text-xs text-gray-400">OR SELECT PAGES</span></div>
                                        </div>
                                      <div className="flex gap-2">
                                          <input type="text" placeholder="e.g. 1-2 (Default: 1-2)" value={pageRange} onChange={(e) => setPageRange(e.target.value)} className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 p-2.5 text-center outline-none" />
                                          <button onClick={() => handleTranslate(false)} disabled={isProcessing} className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50">원문 추출</button>
                                          <button onClick={() => handleTranslate(false, 'aiVision')} disabled={isProcessing} className="px-4 py-2.5 bg-gray-100 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors shadow-sm disabled:opacity-50">인공지능</button>
                                      </div>
                                  </div>
                                </div>
                            </div>
                            <button onClick={handleRemoveFile} className="mt-8 text-xs text-red-500 hover:text-red-700 underline text-center block w-full">Cancel & Upload Different File</button>
                       </div>
                  </div>
              </div>
            ) : (
              <div className="w-full h-full flex overflow-hidden">
                 {/* Sidebar Navigation */}
                 <SidebarNav 
                    totalPages={totalPages}
                    processedPages={processedPageIndices}
                    segments={segments}
                    onPageClick={handleSidebarPageClick}
                    onHeadingClick={handleSidebarHeadingClick}
                    isProcessing={isProcessing}
                    isOpen={isSidebarOpen}
                    onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                 />

                 {/* Main TwinView Area */}
                 <div className="flex-1 flex flex-col min-w-0">
                     <TwinView 
                        segments={segments} 
                        highlightedId={highlightedId} 
                        onHoverSegment={setHighlightedId}
                        onCitationClick={handleCitationClick}
                        pdfUrl={pdfUrl}
                        currentRange={currentActiveRange}
                        onNavigatePage={handlePageNavigation}
                        onExplainSegment={handleExplainSegment}
                        onToggleBookmark={handleToggleBookmark}
                        onUpdateNote={handleUpdateNote}
                        onSyncScroll={setScrollSyncPercentage}
                        onRetranslatePage={handleRetranslatePage} 
                        onLoadNextBatch={handleLoadNextBatch} 
                      />
                 </div>
              </div>
            )}
          </div>
        )}
        
        {isProcessing && segments.length === 0 && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center">
             <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center border border-gray-100 max-w-sm w-full mx-4">
               <div className="relative mb-4">
                 <div className="w-16 h-16 rounded-full border-4 border-gray-100"></div>
                 <div className="absolute top-0 left-0 w-16 h-16 rounded-full border-4 border-primary-600 border-t-transparent animate-spin"></div>
               </div>
               <h3 className="text-xl font-bold text-gray-800 mb-1">Analyzing & Translating</h3>
               <p className="text-gray-500 text-center mb-6 text-sm">{processingStatus || "Processing Content..."}</p>
               <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden mb-2">
                 <div className="h-full bg-primary-600 rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
               </div>
               <p className="text-xs font-bold text-primary-600 text-right mb-4">{Math.round(progress)}%</p>
               
               <button 
                  onClick={handleCancelProcessing}
                  className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm font-medium w-full transition-colors"
               >
                   Stop Processing
               </button>
             </div>
          </div>
        )}
        
        {isProcessing && segments.length > 0 && (
             <div className="absolute top-20 right-8 z-50 bg-white shadow-lg border border-gray-200 rounded-full px-4 py-2 flex items-center gap-3 animate-pulse">
                  <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-xs font-bold text-gray-700">{processingStatus || "Loading..."}</span>
             </div>
        )}

        {/* Portal: External PDF Viewer */}
        {showPdfWindow && pdfUrl && (
          <ExternalPdfViewer 
            pdfUrl={pdfUrl} 
            onClose={() => setShowPdfWindow(false)} 
            scrollPercentage={scrollSyncPercentage}
          />
        )}

        {showTools && <ToolsPanel vocabulary={vocabulary} conclusion={conclusion} onClose={() => setShowTools(false)} onGenerateVocab={handleGenerateVocab} onGenerateConclusion={handleGenerateConclusion} onGeneratePPT={handleGeneratePPT} isProcessing={isProcessing} onUpdateVocabItem={handleUpdateVocabItem} />}
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showAdmin && <AdminDashboard onClose={() => setShowAdmin(false)} />}
        {showChat && segments.length > 0 && <ChatInterface segments={segments} onClose={() => setShowChat(false)} />}
      </main>
    </div>
  );
};

export default App;
