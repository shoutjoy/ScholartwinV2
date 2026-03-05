
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TranslationTone, PaperSegment, VocabularyItem, ConclusionSummary, PaperMetadata, User, ExtractedFigure, PaperAnalysisResult, SegmentType } from './types';
import { fileToBase64, downloadText, printTranslatedPdf, renderPdfPagesToImages, getPdfPageCount, extractTextFromPdfPages, type ExtractedPageText } from './services/fileHelper';
import { translatePagesWithLibreTranslate, type OpenSourceTranslationPage } from './services/libreTranslateService';
import { analyzePaperMetadata, analyzePageContent, extractVocabulary, generateConclusion, findReferenceDetails, explainBlockContent, generatePresentationScript, structureOriginalTextIntoBlocks, translatePlainTextToKorean, translateLinesToKorean, getStoredSettings } from './services/geminiService';
import { saveSessionRecord, listSessionRecords, getSessionRecord, deleteSessionRecord, type StoredSessionRecord } from './services/sessionStoreService';
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

type SnapshotFileData = {
  name: string;
  type: string;
  base64: string;
};

type AppSnapshot = {
  version: number;
  savedAt: string;
  fileData: SnapshotFileData | null;
  tone: TranslationTone;
  pageRange: string;
  currentActiveRange: string;
  lastProcessedPage: number;
  totalPages: number;
  hasStarted: boolean;
  previewTab: 'pdf' | 'text' | 'opensource';
  isSidebarOpen: boolean;
  isPageScrollSyncOn: boolean;
  metadata: PaperMetadata | null;
  segments: PaperSegment[];
  vocabulary: VocabularyItem[];
  conclusion: ConclusionSummary | null;
  extractedPageTexts: ExtractedPageText[] | null;
  structuredOriginalBlocks: Record<number, string[]> | null;
  pageTranslations: Record<number, string[]> | null;
  openSourceTranslations: OpenSourceTranslationPage[] | null;
};

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
  const [pageTranslateProgress, setPageTranslateProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState<string>(''); 
  
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [conclusion, setConclusion] = useState<ConclusionSummary | null>(null);
  const [showTools, setShowTools] = useState(true);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [showPdfMenu, setShowPdfMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [pdfFontSize, setPdfFontSize] = useState<number>(100);

  // UI State
  const [showPdfWindow, setShowPdfWindow] = useState(false);
  const [scrollSyncPercentage, setScrollSyncPercentage] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);
  const [startedView, setStartedView] = useState<'sourceTranslate' | 'twinPages'>('sourceTranslate');
  const [extractedPageTexts, setExtractedPageTexts] = useState<ExtractedPageText[] | null>(null);
  const [extractingText, setExtractingText] = useState(false);
  const [extractTextError, setExtractTextError] = useState<string | null>(null);
  const [structuredOriginalBlocks, setStructuredOriginalBlocks] = useState<Record<number, string[]> | null>(null);
  const [structuringOriginal, setStructuringOriginal] = useState(false);
  const [structuringError, setStructuringError] = useState<string | null>(null);
  const [pageTranslations, setPageTranslations] = useState<Record<number, string[]> | null>(null);
  const [pageTranslating, setPageTranslating] = useState(false);
  const [pageTranslationError, setPageTranslationError] = useState<string | null>(null);
  const [isPageScrollSyncOn, setIsPageScrollSyncOn] = useState(true);
  const [pageSyncHeights, setPageSyncHeights] = useState<Record<number, number>>({});
  const [previewTab, setPreviewTab] = useState<'pdf' | 'text' | 'opensource'>('pdf');
  const [openSourceTranslations, setOpenSourceTranslations] = useState<OpenSourceTranslationPage[] | null>(null);
  const [openSourceTranslating, setOpenSourceTranslating] = useState(false);
  const [showSessionSidebar, setShowSessionSidebar] = useState(false);
  const [sessionRecords, setSessionRecords] = useState<StoredSessionRecord[]>([]);
  const [sessionStatus, setSessionStatus] = useState('');
  const [sessionBusy, setSessionBusy] = useState(false);

  const abortRef = useRef(false);
  const originalScrollRef = useRef<HTMLDivElement | null>(null);
  const aiScrollRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScrollRef = useRef(false);
  const stpFileInputRef = useRef<HTMLInputElement | null>(null);
  const isRestoringSnapshotRef = useRef(false);
  const sourceTranslateAutoTranslateDoneRef = useRef(false);

  const confirmAiExecution = (actionLabel: string) => {
    return window.confirm(`AI 동작을 실행할까요?\n작업: ${actionLabel}`);
  };

  const ensureAiApiReady = (actionLabel: string) => {
    const settings = getStoredSettings();
    const configuredKey = (settings.apiKey || '').trim();
    const envKey = String((process as any)?.env?.API_KEY || '').trim();
    if (configuredKey || envKey) return true;

    alert(`AI 설정(API Key)이 없어 "${actionLabel}"을 시작할 수 없습니다.\n설정 창에서 API Key를 먼저 입력해 주세요.`);
    setShowSettings(true);
    return false;
  };

  // Computed state for sidebar
  const processedPageIndices = useMemo(() => {
      const indices = new Set(
        segments
          .filter((s) => {
            const isFallback = s.id.startsWith('fallback_') || s.original.includes('AI 분석 결과가 비어');
            const isError = s.id.startsWith('err_') || s.original.startsWith('[Error processing Page');
            return !isFallback && !isError;
          })
          .map((s) => s.pageIndex)
      );
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
      getPdfPageCount(selectedFile).then(count => setTotalPages(count));
      setExtractingText(true);
      setExtractTextError(null);
      setExtractedPageTexts(null);
      extractTextFromPdfPages(selectedFile, 9999)
        .then(pages => { setExtractedPageTexts(pages); setExtractTextError(null); })
        .catch(err => { setExtractTextError(err?.message || 'Failed'); setExtractedPageTexts(null); })
        .finally(() => setExtractingText(false));
      return () => URL.revokeObjectURL(url);
    } else {
      setPdfUrl(null);
      setTotalPages(0);
      setExtractedPageTexts(null);
      setExtractingText(false);
      setExtractTextError(null);
      setStructuredOriginalBlocks(null);
      setStructuringOriginal(false);
      setStructuringError(null);
      setPageTranslations(null);
      setPageTranslating(false);
      setPageTranslationError(null);
      setPreviewTab('pdf');
      setOpenSourceTranslations(null);
      setHasStarted(false);
      setStartedView('sourceTranslate');
      sourceTranslateAutoTranslateDoneRef.current = false;
    }
  }, [selectedFile]);

  useEffect(() => {
    if (!extractedPageTexts || extractedPageTexts.length === 0) {
      setStructuredOriginalBlocks(null);
      setStructuringOriginal(false);
      setStructuringError(null);
      return;
    }
    if (isRestoringSnapshotRef.current) return;

    let cancelled = false;
    const runStructuring = async () => {
      if (!confirmAiExecution('원문 문장 복원 및 블록화')) return;
      setStructuringOriginal(true);
      setStructuringError(null);
      try {
        const entries = await Promise.all(
          extractedPageTexts.map(async (p) => {
            const blocks = await structureOriginalTextIntoBlocks(p.text);
            return [p.pageIndex, blocks] as const;
          })
        );
        if (!cancelled) {
          setStructuredOriginalBlocks(Object.fromEntries(entries));
        }
      } catch (err: any) {
        if (!cancelled) {
          setStructuringError(err?.message || 'Failed to structure original text blocks.');
          setStructuredOriginalBlocks(null);
        }
      } finally {
        if (!cancelled) {
          setStructuringOriginal(false);
        }
      }
    };

    runStructuring();
    return () => {
      cancelled = true;
    };
  }, [extractedPageTexts]);

  useEffect(() => {
    listSessionRecords()
      .then(setSessionRecords)
      .catch(() => {});
  }, []);

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

  const refreshSessionRecords = async () => {
    try {
      const items = await listSessionRecords();
      setSessionRecords(items);
    } catch (error: any) {
      setSessionStatus(`목록 조회 실패: ${error?.message || 'unknown error'}`);
    }
  };

  const base64ToFile = (base64: string, fileName: string, mimeType: string): File => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName, { type: mimeType || 'application/pdf' });
  };

  const buildCurrentSnapshot = async (): Promise<AppSnapshot> => {
    const fileData: SnapshotFileData | null = selectedFile
      ? {
          name: selectedFile.name,
          type: selectedFile.type,
          base64: await fileToBase64(selectedFile)
        }
      : null;

    return {
      version: 1,
      savedAt: new Date().toISOString(),
      fileData,
      tone,
      pageRange,
      currentActiveRange,
      lastProcessedPage,
      totalPages,
      hasStarted,
      previewTab,
      isSidebarOpen,
      isPageScrollSyncOn,
      metadata,
      segments,
      vocabulary,
      conclusion,
      extractedPageTexts,
      structuredOriginalBlocks,
      pageTranslations,
      openSourceTranslations
    };
  };

  const applySnapshot = async (snapshot: AppSnapshot) => {
    isRestoringSnapshotRef.current = true;
    try {
      if (snapshot.fileData?.base64) {
        const restoredFile = base64ToFile(snapshot.fileData.base64, snapshot.fileData.name, snapshot.fileData.type);
        setSelectedFile(restoredFile);
      } else {
        setSelectedFile(null);
      }

      setTimeout(() => {
        setTone(snapshot.tone || TranslationTone.ACADEMIC);
        setPageRange(snapshot.pageRange || '');
        setCurrentActiveRange(snapshot.currentActiveRange || '');
        setLastProcessedPage(snapshot.lastProcessedPage || 0);
        setTotalPages(snapshot.totalPages || 0);
        setHasStarted(Boolean(snapshot.hasStarted));
        setPreviewTab(snapshot.previewTab || 'pdf');
        setIsSidebarOpen(snapshot.isSidebarOpen ?? true);
        setIsPageScrollSyncOn(snapshot.isPageScrollSyncOn ?? true);
        setMetadata(snapshot.metadata || null);
        setSegments(snapshot.segments || []);
        setVocabulary(snapshot.vocabulary || []);
        setConclusion(snapshot.conclusion || null);
        setExtractedPageTexts(snapshot.extractedPageTexts || null);
        setStructuredOriginalBlocks(snapshot.structuredOriginalBlocks || null);
        setPageTranslations(snapshot.pageTranslations || null);
        setOpenSourceTranslations(snapshot.openSourceTranslations || null);
        setSessionStatus('저장된 상태를 불러왔습니다.');
        setTimeout(() => {
          isRestoringSnapshotRef.current = false;
        }, 1200);
      }, 250);
    } catch (error: any) {
      isRestoringSnapshotRef.current = false;
      throw error;
    }
  };

  const handleSaveToIndexedDb = async () => {
    try {
      setSessionBusy(true);
      setSessionStatus('저장 중...');
      const snapshot = await buildCurrentSnapshot();
      const now = new Date().toISOString();
      const record: StoredSessionRecord = {
        id: `session-${Date.now()}`,
        title: `${selectedFile?.name || 'Untitled'} (${new Date().toLocaleString()})`,
        createdAt: now,
        updatedAt: now,
        payload: snapshot
      };
      await saveSessionRecord(record);
      await refreshSessionRecords();
      setSessionStatus('IndexedDB 저장 완료');
    } catch (error: any) {
      setSessionStatus(`저장 실패: ${error?.message || 'unknown error'}`);
    } finally {
      setSessionBusy(false);
    }
  };

  const handleLoadFromIndexedDb = async (id: string) => {
    try {
      setSessionBusy(true);
      setSessionStatus('불러오는 중...');
      const record = await getSessionRecord(id);
      if (!record?.payload) {
        setSessionStatus('불러올 데이터를 찾지 못했습니다.');
        return;
      }
      await applySnapshot(record.payload as AppSnapshot);
    } catch (error: any) {
      setSessionStatus(`불러오기 실패: ${error?.message || 'unknown error'}`);
    } finally {
      setSessionBusy(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSessionRecord(id);
      await refreshSessionRecords();
      setSessionStatus('세션 삭제 완료');
    } catch (error: any) {
      setSessionStatus(`삭제 실패: ${error?.message || 'unknown error'}`);
    }
  };

  const handleExportStp = async () => {
    try {
      setSessionBusy(true);
      const snapshot = await buildCurrentSnapshot();
      const payload = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedFile?.name || 'scholartwin'}-${Date.now()}.stp`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSessionStatus('.stp 내보내기 완료');
    } catch (error: any) {
      setSessionStatus(`내보내기 실패: ${error?.message || 'unknown error'}`);
    } finally {
      setSessionBusy(false);
    }
  };

  const handleImportStpFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await importSnapshotFromStpFile(file, true);
  };

  const importSnapshotFromStpFile = async (file: File, showSessionMessage: boolean = false) => {
    try {
      setSessionBusy(true);
      const text = await file.text();
      const parsed = JSON.parse(text) as AppSnapshot;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('잘못된 STP 파일입니다.');
      }
      await applySnapshot(parsed);
      if (showSessionMessage) {
        setSessionStatus('.stp 불러오기 완료');
      }
    } catch (error: any) {
      const message = `불러오기 실패: ${error?.message || 'unknown error'}`;
      if (showSessionMessage) {
        setSessionStatus(message);
      } else {
        alert(message);
      }
    } finally {
      setSessionBusy(false);
    }
  };

  // --- Core App Logic ---
  const handleFileSelect = async (file: File) => {
    const isStpFile = /\.stp$/i.test(file.name);
    const isPdfFile = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

    if (isStpFile) {
      await importSnapshotFromStpFile(file, false);
      return;
    }

    if (!isPdfFile) {
      alert('PDF 또는 STP 파일만 업로드할 수 있습니다.');
      return;
    }

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
    setStartedView('sourceTranslate');
  };

  const handleCancelProcessing = () => {
      abortRef.current = true;
  };

  const executeTranslation = async (startPage: number, endPage: number, isAppend: boolean = false) => {
    if (!selectedFile) return;
    if (!confirmAiExecution(`페이지 번역 (${startPage}-${endPage})`)) return;
    if (!ensureAiApiReady(`페이지 번역 (${startPage}-${endPage})`)) return;
    try {
      setIsProcessing(true);
      abortRef.current = false;
      setProgress(5); 
      setProcessingStatus('Preparing PDF...');
      
      // Keep current page in place while new translation runs in background.
      
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

      let processedUntil = isAppend ? lastProcessedPage : (startPage - 1);
      for (let i = 0; i < pagesToProcess.length; i++) {
          if (abortRef.current) break;
          const pageImg = pagesToProcess[i];
          const currentProgress = 10 + Math.round(((i + 1) / pagesToProcess.length) * 80);
          setProgress(currentProgress);
          setProcessingStatus(`Processing Page ${pageImg.pageIndex} of ${endPage}...`);

          const pageSegments = await analyzePageContent(pageImg.base64, pageImg.pageIndex - 1, tone);
          if (abortRef.current) break;

          const isAiPageFailure =
            pageSegments.length === 0 ||
            pageSegments.every(
              (seg) => seg.id.startsWith('err_') || seg.original.startsWith('[Error processing Page')
            );

          let safePageSegments: PaperSegment[] = pageSegments;

          // If page 1 AI parsing fails, fallback to already extracted original text from the source panel.
          if (isAiPageFailure && pageImg.pageIndex === 1) {
            const extractedPageOne = extractedPageTexts?.find((p) => p.pageIndex === 1)?.text?.trim() || '';
            if (extractedPageOne) {
              const blocks =
                (structuredOriginalBlocks?.[1] && structuredOriginalBlocks[1].length > 0
                  ? structuredOriginalBlocks[1]
                  : extractedPageOne
                      .split(/\n\s*\n/g)
                      .map((b) => b.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim())
                      .filter(Boolean)
                ).slice(0, 12);

              setProcessingStatus('Page 1 fallback: 원문 텍스트 기반으로 재구성 중...');
              const translatedBlocks = await Promise.all(
                blocks.map(async (block) => {
                  try {
                    return await translatePlainTextToKorean(block);
                  } catch {
                    return `[자동번역 실패]\n${block}`;
                  }
                })
              );

              safePageSegments = blocks.map((block, idx) => ({
                id: `fallback_pg1_${idx}_${Date.now()}`,
                pageIndex: 1,
                type: SegmentType.TEXT,
                original: block,
                translated: translatedBlocks[idx] || block,
                citations: []
              }));
            }
          }

          if (safePageSegments.length === 0) {
            safePageSegments = [{
              id: `fallback_${pageImg.pageIndex}_${Date.now()}`,
              pageIndex: pageImg.pageIndex,
              type: SegmentType.TEXT,
              original: `[Page ${pageImg.pageIndex}] AI 분석 결과가 비어 원문 페이지 텍스트를 직접 확인해 주세요.`,
              translated: `[페이지 ${pageImg.pageIndex}] AI 분석 결과가 비어 있어 자동으로 자리표시 블록을 생성했습니다.`,
              citations: []
            }];
          }

          setSegments(prev => {
              const filtered = prev.filter(s => s.pageIndex !== pageImg.pageIndex);
              return [...filtered, ...safePageSegments];
          });
          processedUntil = Math.max(processedUntil, pageImg.pageIndex);
          setLastProcessedPage(prev => Math.max(prev, pageImg.pageIndex));
      }

      const effectiveEnd = processedUntil >= startPage ? processedUntil : endPage;
      const newRangeStr = `${startPage}-${effectiveEnd}`; // Update range to what was actually processed
      setCurrentActiveRange(prev => isAppend ? (prev ? `${prev}, ${newRangeStr}` : newRangeStr) : newRangeStr);
      setProgress(100);

      if (processedUntil >= startPage) {
        setTimeout(() => {
          const el = document.getElementById(`page-container-${startPage}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 0);
      }

    } catch (error: any) {
      console.error("Translation Error:", error);
      if ((error?.message || '').includes('API Key not found')) {
        alert('API Key가 없어 번역을 진행할 수 없습니다. 설정에서 API Key를 입력해 주세요.');
        setShowSettings(true);
      } else {
        alert("Failed to process PDF.");
      }
      setProgress(0);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleRetranslatePage = async (pageIndex: number) => {
    await executeTranslation(pageIndex, pageIndex, true);
  };

  const handleTranslate = async (isFull: boolean) => {
    if (!selectedFile) return;

    // Enter the main reading/translation screen first, then run translation in background.
    if (!hasStarted) {
      setHasStarted(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    
    if (isFull) {
        await executeTranslation(1, totalPages || 9999, false);
    } else {
        // [1-2p시작] 버튼: 무조건 1페이지만 (페이지 범위 무시)
        await executeTranslation(1, 1, false);
    }
  };

  const handleLoadNextBatch = () => {
      const nextStart = lastProcessedPage + 1;
      const nextEnd = nextStart; // Load 1 page
      executeTranslation(nextStart, nextEnd, true);
  };

  const handleSidebarPageClick = async (pageIndex: number, isProcessed: boolean) => {
      if (isProcessed) {
          const el = document.getElementById(`page-container-${pageIndex}`);
          if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
      } else {
          if (confirm(`Translate Page ${pageIndex} now?`)) {
              // Ensure translated page blocks are shown in TwinView left pane.
              setHasStarted(true);
              setStartedView('twinPages');
              await executeTranslation(pageIndex, pageIndex, true);
              setTimeout(() => {
                const el = document.getElementById(`page-container-${pageIndex}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 0);
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

  const syncScrollByRatio = (source: 'original' | 'ai') => {
    if (!isPageScrollSyncOn || isSyncingScrollRef.current) return;
    const sourceEl = source === 'original' ? originalScrollRef.current : aiScrollRef.current;
    const targetEl = source === 'original' ? aiScrollRef.current : originalScrollRef.current;
    if (!sourceEl || !targetEl) return;

    const shouldUsePageSync = hasStarted && startedView === 'sourceTranslate';
    const getAnchorTop = (anchor: HTMLElement, container: HTMLElement) =>
      anchor.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;

    const syncByPageAnchor = () => {
      const sourceAnchors = Array.from(sourceEl.querySelectorAll<HTMLElement>('[data-sync-page]'));
      const targetAnchors = Array.from(targetEl.querySelectorAll<HTMLElement>('[data-sync-page]'));
      if (sourceAnchors.length === 0 || targetAnchors.length === 0) return false;

      const sourceAnchorTops = sourceAnchors.map((el) => getAnchorTop(el, sourceEl));
      let currentSourceAnchorIndex = 0;
      for (let i = 0; i < sourceAnchorTops.length; i++) {
        if (sourceAnchorTops[i] <= sourceEl.scrollTop + 1) currentSourceAnchorIndex = i;
        else break;
      }

      const currentSourceAnchor = sourceAnchors[currentSourceAnchorIndex];
      const currentPage = currentSourceAnchor.dataset.syncPage;
      if (!currentPage) return false;

      const targetAnchorIndex = targetAnchors.findIndex((el) => el.dataset.syncPage === currentPage);
      if (targetAnchorIndex < 0) return false;

      const sourceStart = sourceAnchorTops[currentSourceAnchorIndex];
      const sourceEnd = currentSourceAnchorIndex + 1 < sourceAnchorTops.length
        ? sourceAnchorTops[currentSourceAnchorIndex + 1]
        : sourceEl.scrollHeight;
      const sourceSpan = Math.max(1, sourceEnd - sourceStart);
      const sourceProgress = Math.min(1, Math.max(0, (sourceEl.scrollTop - sourceStart) / sourceSpan));

      const targetAnchorTops = targetAnchors.map((el) => getAnchorTop(el, targetEl));
      const targetStart = targetAnchorTops[targetAnchorIndex];
      const targetEnd = targetAnchorIndex + 1 < targetAnchorTops.length
        ? targetAnchorTops[targetAnchorIndex + 1]
        : targetEl.scrollHeight;
      const targetSpan = Math.max(1, targetEnd - targetStart);
      const targetScrollable = Math.max(0, targetEl.scrollHeight - targetEl.clientHeight);
      const alignedScrollTop = Math.min(
        targetScrollable,
        Math.max(0, targetStart + sourceProgress * targetSpan)
      );

      targetEl.scrollTop = alignedScrollTop;
      return true;
    };

    const sourceScrollable = sourceEl.scrollHeight - sourceEl.clientHeight;
    const targetScrollable = targetEl.scrollHeight - targetEl.clientHeight;
    const ratio = sourceScrollable > 0 ? sourceEl.scrollTop / sourceScrollable : 0;

    isSyncingScrollRef.current = true;
    if (!shouldUsePageSync || !syncByPageAnchor()) {
      targetEl.scrollTop = ratio * Math.max(targetScrollable, 0);
    }
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  };

  // 원문 / AI페이지번역 페이지 단위 동일 높이 맞춤 (스크롤 동기화 시 같은 페이지가 같은 위치에 오도록)
  useEffect(() => {
    if (!hasStarted || startedView !== 'sourceTranslate' || !extractedPageTexts?.length) return;
    const leftCol = originalScrollRef.current;
    const rightCol = aiScrollRef.current;
    if (!leftCol || !rightCol) return;

    const measure = () => {
      const leftPages = leftCol.querySelectorAll<HTMLElement>('[data-sync-page]');
      const rightPages = rightCol.querySelectorAll<HTMLElement>('[data-sync-page]');
      const next: Record<number, number> = {};
      leftPages.forEach((leftEl) => {
        const pageStr = leftEl.dataset.syncPage;
        if (!pageStr) return;
        const pageIndex = parseInt(pageStr, 10);
        const rightEl = Array.from(rightPages).find((el) => el.dataset.syncPage === pageStr);
        const lH = leftEl.offsetHeight || 0;
        const rH = rightEl ? rightEl.offsetHeight || 0 : 0;
        next[pageIndex] = Math.max(lH, rH, 120);
      });
      setPageSyncHeights((prev) => {
        const merged = { ...prev, ...next };
        return Object.keys(merged).length ? merged : prev;
      });
    };

    const t1 = setTimeout(measure, 150);
    const t2 = setTimeout(measure, 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [hasStarted, startedView, extractedPageTexts, pageTranslations, structuredOriginalBlocks, pageTranslating]);

  const handlePageNavigation = (direction: 'next' | 'prev') => {
  };

  const handleResetTranslation = () => {
    setSegments([]);
    setCurrentActiveRange('');
    setLastProcessedPage(0);
    setHasStarted(false);
    setStartedView('sourceTranslate');
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setSegments([]);
    setShowPdfWindow(false);
    setHasStarted(false);
  };

  const handleOpenSourceTranslate = async () => {
    if (!extractedPageTexts?.length) return;
    setOpenSourceTranslating(true);
    try {
      const result = await translatePagesWithLibreTranslate(
        extractedPageTexts.map((p) => ({ pageIndex: p.pageIndex, text: p.text })),
        'en',
        'ko',
        undefined,
        (done, total) => setProcessingStatus(`오픈소스 번역 중 ${done}/${total}페이지...`)
      );
      setOpenSourceTranslations(result);
    } catch (e: any) {
      console.error('LibreTranslate error', e);
      alert(`오픈소스 번역 실패: ${e?.message || 'Unknown error'}. LibreTranslate 서버 상태를 확인하거나 나중에 다시 시도하세요.`);
    } finally {
      setOpenSourceTranslating(false);
      setProcessingStatus('');
    }
  };

  const handlePageTranslate = async () => {
    if (!extractedPageTexts?.length) {
      alert('원문 텍스트가 없습니다. 먼저 원문 추출을 완료해 주세요.');
      return;
    }
    if (pageTranslating) return;
    if (!ensureAiApiReady('AI페이지번역')) return;
    if (!confirmAiExecution('AI페이지번역')) return;
    await runPageTranslation();
  };

  const runPageTranslation = async () => {
    if (!extractedPageTexts?.length || pageTranslating) return;
    setPageTranslating(true);
    setPageTranslationError(null);
    setPageTranslations(null);
    setPageTranslateProgress(0);

    try {
      const result: Record<number, string[]> = {};
      const totalPagesToTranslate = extractedPageTexts.length;
      const pageBlockMap = extractedPageTexts.map((page) => {
        const blocks = structuredOriginalBlocks?.[page.pageIndex]?.length
          ? structuredOriginalBlocks[page.pageIndex]
          : (page.text?.trim() ? [page.text] : []);
        return { page, blocks };
      });
      const totalBlocks = Math.max(
        1,
        pageBlockMap.reduce((acc, item) => acc + Math.max(1, item.blocks.length), 0)
      );
      let doneBlocks = 0;

      for (let i = 0; i < pageBlockMap.length; i++) {
        const { page, blocks: sourceBlocks } = pageBlockMap[i];

        setProcessingStatus(`페이지 ${page.pageIndex} 번역 중 (${i + 1}/${totalPagesToTranslate})...`);

        const translatedBlocks: string[] = [];
        if (sourceBlocks.length === 0) {
          doneBlocks += 1;
          setPageTranslateProgress(Math.min(100, Math.round((doneBlocks / totalBlocks) * 100)));
        } else {
          for (let j = 0; j < sourceBlocks.length; j++) {
            setProcessingStatus(`페이지 ${page.pageIndex} 블록 ${j + 1}/${sourceBlocks.length} 번역 중...`);
            const translated = await translatePlainTextToKorean(sourceBlocks[j]);
            translatedBlocks.push(translated || '(번역 결과 없음)');
            doneBlocks += 1;
            setPageTranslateProgress(Math.min(100, Math.round((doneBlocks / totalBlocks) * 100)));
          }
        }

        result[page.pageIndex] = translatedBlocks;
        setPageTranslations({ ...result });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      setPageTranslateProgress(100);
      setProcessingStatus('페이지 번역 완료');
    } catch (error: any) {
      console.error('Page translation failed', error);
      setPageTranslationError(error?.message || '페이지 번역 중 오류가 발생했습니다.');
    } finally {
      setPageTranslating(false);
      setTimeout(() => setProcessingStatus(''), 1200);
    }
  };

  // 입장하는 동시에 AI페이지번역 실행: sourceTranslate 화면에 들어왔을 때 번역이 없으면 자동으로 번역 시작
  useEffect(() => {
    if (
      !hasStarted ||
      startedView !== 'sourceTranslate' ||
      !extractedPageTexts?.length ||
      isProcessing ||
      pageTranslating ||
      (pageTranslations != null && Object.keys(pageTranslations).length > 0) ||
      sourceTranslateAutoTranslateDoneRef.current
    )
      return;
    if (!getStoredSettings()?.apiKey?.trim() && !(process as any)?.env?.API_KEY) return;
    sourceTranslateAutoTranslateDoneRef.current = true;
    runPageTranslation();
  }, [hasStarted, startedView, extractedPageTexts, isProcessing, pageTranslating, pageTranslations]);

  const normalizeTextForGoogleTranslate = (text: string): string => {
    const source = (text || '').replace(/\r\n/g, '\n').trim();
    if (!source) return '';

    // Fix common PDF line-wrap hyphenation like "transla-\ntion" -> "translation".
    const dehyphenated = source.replace(/([A-Za-z])-\n([A-Za-z])/g, '$1$2');
    const lines = dehyphenated.split('\n').map((line) => line.trim());
    const output: string[] = [];
    let paragraphBuffer = '';

    const flushParagraph = () => {
      if (paragraphBuffer.trim()) output.push(paragraphBuffer.trim());
      paragraphBuffer = '';
    };

    for (const line of lines) {
      if (!line) {
        flushParagraph();
        continue;
      }

      const isPageMarker = /^---\s*Page\s+\d+\s*---$/i.test(line);
      const isListLike = /^([\-*+•]\s+|\d+[\.\)]\s+)/.test(line);

      if (isPageMarker || isListLike) {
        flushParagraph();
        output.push(line);
        continue;
      }

      paragraphBuffer = paragraphBuffer ? `${paragraphBuffer} ${line}` : line;
    }
    flushParagraph();

    return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  const openGoogleTranslateWithText = (rawTextInput: string) => {
    const rawText = normalizeTextForGoogleTranslate(rawTextInput || '');
    if (!rawText) {
      alert('원문 텍스트가 없습니다. 먼저 원문 추출을 완료해 주세요.');
      return;
    }

    // URL 길이 제한을 고려해 텍스트를 안전한 길이로 제한합니다.
    const maxChars = 4000;
    const textForUrl = rawText.slice(0, maxChars);
    const url = `https://translate.google.co.kr/?sl=en&tl=ko&op=translate&text=${encodeURIComponent(textForUrl)}`;
    window.open(url, '_blank', 'noopener,noreferrer');

    if (rawText.length > maxChars) {
      alert('원문이 길어 앞부분만 Google 번역에 전달되었습니다.');
    }
  };

  const handleOpenGoogleTranslate = () => {
    const rawText = extractedPageTexts
      ?.map((p) => p.textWithPageMarker || p.text || '')
      .join('\n')
      .trim();
    openGoogleTranslateWithText(rawText || '');
  };

  const handleOpenGoogleTranslateForPage = (pageIndex: number) => {
    const page = extractedPageTexts?.find((p) => p.pageIndex === pageIndex);
    if (!page) {
      alert('페이지 원문을 찾을 수 없습니다.');
      return;
    }
    openGoogleTranslateWithText(page.textWithPageMarker || page.text || '');
  };

  const handleGenerateVocab = async () => {
    if (segments.length === 0) return;
    if (!confirmAiExecution('용어 추출')) return;
    setIsProcessing(true);
    setProcessingStatus('Extracting Vocabulary...');
    try {
      const vocab = await extractVocabulary(segments);
      setProcessingStatus('한국어 번역 생성 중...');
      const definitions = vocab.map(v => v.definition);
      const contexts = vocab.map(v => v.context);
      const terms = vocab.map(v => v.term);
      const [definitionsKo, contextsKo, termsKo] = await Promise.all([
        translateLinesToKorean(definitions),
        translateLinesToKorean(contexts),
        translateLinesToKorean(terms)
      ]);
      const vocabWithKo = vocab.map((v, i) => ({
        ...v,
        definitionKo: definitionsKo[i] || undefined,
        contextKo: contextsKo[i] || undefined,
        termKo: termsKo[i] || undefined
      }));
      setVocabulary(vocabWithKo);
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
    if (!confirmAiExecution('결론 요약 생성')) return;
    setIsProcessing(true);
    setProcessingStatus('Summarizing Conclusion...');
    try {
      const summary = await generateConclusion(segments);
      setProcessingStatus('한국어 번역 생성 중...');
      const [researchQuestionsKo, resultsKo, implicationsKo] = await Promise.all([
        translateLinesToKorean(summary.researchQuestions),
        translateLinesToKorean(summary.results),
        translateLinesToKorean(summary.implications)
      ]);
      setConclusion({
        ...summary,
        researchQuestionsKo,
        resultsKo,
        implicationsKo
      });
    } catch (e) {
      alert("Failed to generate conclusion.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleGeneratePPT = async () => {
      if (segments.length === 0) return "";
      if (!confirmAiExecution('PPT 스크립트 생성')) return "";
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
    if (!confirmAiExecution('문단 설명 생성')) return;

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

  const handleOpenPdfNewWindow = () => {
    if (!pdfUrl) {
      setShowPdfMenu(false);
      return;
    }
    // Prefer anchor-click new tab because some browsers block window.open for blob URLs.
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowPdfMenu(false);
  };

  const handleCitationClick = async (citation: string) => {
    if (!confirmAiExecution('참고문헌 상세 찾기')) return;
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
          <button
                onClick={() => { setHasStarted(true); setShowPdfWindow(false); setStartedView('sourceTranslate'); }}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors"
          >
                원문번역
          </button>
              <button
                onClick={() => { setHasStarted(true); setShowPdfWindow(false); setStartedView('twinPages'); }}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors"
              >
                원문+번역 페이지
              </button>
          {selectedFile ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setHasStarted(false); setShowPdfWindow(false); }}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors"
              >
                Prev
              </button>
              <button
                onClick={handlePageTranslate}
                disabled={pageTranslating || extractingText || !extractedPageTexts?.length || (hasStarted && segments.length > 0)}
                className="text-sm font-medium text-gray-600 hover:text-primary-600 px-3 py-2 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors disabled:opacity-50"
              >
                {pageTranslating ? '[페이지번역 중]' : '[페이지번역]'}
              </button>
              <button
                onClick={() => handleTranslate(false)}
                disabled={isProcessing}
                className="text-sm font-medium text-gray-600 hover:text-primary-600 px-3 py-2 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors disabled:opacity-50"
              >
                [차례로]
              </button>
              <button
                onClick={() => handleTranslate(true)}
                disabled={isProcessing}
                className="text-sm font-medium text-gray-600 hover:text-primary-600 px-3 py-2 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors disabled:opacity-50"
              >
                [full시작]
              </button>
              <button 
                onClick={() => setShowTools(true)}
                className="text-sm font-medium text-gray-600 hover:text-primary-600 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Study Assistant
              </button>
              {segments.length > 0 && (
                <>
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
                        onClick={handleOpenPdfNewWindow}
                        className="w-full text-left px-4 py-3 text-xs hover:bg-gray-50 flex items-center gap-2 text-indigo-600 font-medium"
                      >
                        <span>❐</span> 새창 PDF
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
                </>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500 mr-2 flex items-center gap-2">
               <span>Welcome, <strong>{currentUser.name}</strong></span>
               {currentUser.isPaid && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200">Premium</span>}
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSessionSidebar((prev) => !prev)}
              className="text-xs font-medium text-gray-600 hover:text-primary-600 px-2 py-1.5 rounded border border-gray-200 hover:bg-gray-100"
              title="세션 메뉴"
            >
              세션
            </button>
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
                 <button onClick={() => alert('준비중입니다')} title="준비중" className="text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100 transition-colors">
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                     <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                   </svg>
                 </button>
                 {pendingUserCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center animate-pulse">{pendingUserCount}</span>}
             </div>
          )}
          <button
            onClick={handleResetTranslation}
            disabled={segments.length === 0}
            className="text-xs text-gray-600 hover:text-gray-900 font-medium px-2 py-1 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            초기화
          </button>
          <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1">Logout</button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative flex flex-col overflow-hidden justify-center">
        <div className="absolute top-2 left-4 z-20 text-xs font-bold uppercase tracking-wider text-gray-500">원문번역</div>
        {hasStarted && (isProcessing || pageTranslating) && (
          <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-white/95 backdrop-blur border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm font-medium text-gray-800 pointer-events-none">
            <span className="tabular-nums">{isProcessing ? progress : pageTranslateProgress}%</span>
            {processingStatus && <span className="text-gray-500 text-xs max-w-[180px] truncate">{processingStatus}</span>}
          </div>
        )}
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
          hasStarted ? (
            <div className="flex-1 flex w-full max-w-7xl mx-auto shadow-xl bg-white overflow-hidden h-[calc(100vh-80px)] rounded-xl border border-gray-200">
              <div className="w-full flex flex-col items-center justify-center p-8">
                <div className="max-w-2xl w-full">
                  <div className="text-center mb-6">
                    <h2 className="text-xl font-bold text-gray-800">Main 화면</h2>
                    <p className="text-sm text-gray-500 mt-1">업로드 없이 메인에 진입했습니다. 파일을 올리면 바로 작업할 수 있습니다.</p>
                  </div>
                  <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full flex-1 flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
              <div className="max-w-2xl w-full">
                <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />
                <div className="mt-8 text-center text-gray-400 text-sm">
                  <p>Supported: PDF, STP Project Files</p>
                  <p>Features: Translation, Twin View, Vocab Extraction, Scholar Grounding</p>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="flex-1 flex w-full max-w-7xl mx-auto shadow-xl bg-white overflow-hidden h-[calc(100vh-80px)] rounded-xl border border-gray-200">
            {!hasStarted ? (
              <div className="flex w-full h-full">
                  <div className="w-1/2 bg-slate-100 border-r border-gray-200 hidden md:flex flex-col relative group">
                      <div className="flex-shrink-0 flex border-b border-gray-200 bg-white">
                        <button onClick={() => setPreviewTab('pdf')} className={`px-4 py-3 text-sm font-medium ${previewTab === 'pdf' ? 'bg-slate-100 text-gray-900 border-b-2 border-primary-500 -mb-px' : 'text-gray-500 hover:text-gray-700'}`}>PDF</button>
                        <button onClick={() => setPreviewTab('text')} className={`px-4 py-3 text-sm font-medium flex items-center gap-1 ${previewTab === 'text' ? 'bg-slate-100 text-gray-900 border-b-2 border-primary-500 -mb-px' : 'text-gray-500 hover:text-gray-700'}`}>원본(text){extractingText && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}</button>
                        <button onClick={() => setPreviewTab('opensource')} className={`px-4 py-3 text-sm font-medium flex items-center gap-1 ${previewTab === 'opensource' ? 'bg-slate-100 text-gray-900 border-b-2 border-primary-500 -mb-px' : 'text-gray-500 hover:text-gray-700'}`}>오픈소스 번역결과{openSourceTranslating && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}</button>
                      </div>
                      <div className="flex-1 min-h-0 relative">
                        {previewTab === 'pdf' ? (
                          <>
                            {showPdfWindow ? (
                              <div className="h-full p-6 bg-gray-100/70 overflow-y-auto">
                                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-4 flex items-center justify-between">
                                  <h3 className="font-bold text-gray-800 text-base">페이지별 원문 블록</h3>
                                  <button onClick={() => setShowPdfWindow(false)} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg border border-gray-300">PDF 미리보기로 돌아가기</button>
                                </div>
                                {extractedPageTexts && extractedPageTexts.length > 0 ? (
                                  <div className="space-y-4">
                                    {extractedPageTexts.map((p) => (
                                      <div key={`preview-page-${p.pageIndex}`} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                        <div className="px-4 py-2 border-b border-gray-200 bg-slate-50 flex items-center justify-between">
                                          <span className="text-xs font-bold text-gray-600">--- Page {p.pageIndex} ---</span>
                                          <button
                                            onClick={() => handleOpenGoogleTranslateForPage(p.pageIndex)}
                                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-md"
                                          >
                                            Google번역으로 보내기
                                          </button>
                                        </div>
                                        <pre className="p-4 text-xs text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{p.text || '(no text)'}</pre>
                                      </div>
                                    ))}
                                  </div>
                                ) : extractingText ? (
                                  <div className="h-[220px] bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center text-gray-500">
                                    <div className="w-7 h-7 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-2" />
                                    <p className="text-sm">원문 추출 중...</p>
                                  </div>
                                ) : (
                                  <div className="h-[220px] bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 text-sm">
                                    페이지 원문이 아직 없습니다.
                                  </div>
                                )}
                                <div className="mt-4 text-right">
                                  <button onClick={handleOpenGoogleTranslate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow font-medium text-sm">
                                    전체 원문 Google 번역으로 열기
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {pdfUrl && <object data={`${pdfUrl}#toolbar=0&navpanes=0`} type="application/pdf" className="w-full h-full"><div className="flex flex-col items-center justify-center h-full text-gray-400 p-10 text-center"><p>Preview not available.</p></div></object>}
                                <div className="absolute top-4 left-4 bg-black/50 backdrop-blur text-white text-xs px-2 py-1 rounded pointer-events-none">PDF Preview</div>
                                <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                  <div className="flex flex-col items-center gap-3 pointer-events-auto">
                                    <button onClick={() => setShowPdfWindow(true)} className="bg-white text-gray-800 px-5 py-3 rounded-full shadow-lg font-bold hover:scale-105">Open Synced PDF Window</button>
                                  </div>
                                </div>
                              </>
                            )}
                          </>
                        ) : previewTab === 'text' ? (
                          <div className="absolute inset-0 flex flex-col bg-white overflow-hidden">
                            {extractingText ? (
                              <div className="flex-1 flex flex-col items-center justify-center p-8 text-gray-500"><div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-3" /><p className="text-sm">원문 추출 중...</p></div>
                            ) : extractTextError ? (
                              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center"><p className="text-sm text-amber-700">추출 실패</p><p className="text-xs text-gray-500 mt-1">{extractTextError}</p></div>
                            ) : extractedPageTexts && extractedPageTexts.length > 0 ? (
                              <div className="flex-1 overflow-y-auto p-4"><pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{extractedPageTexts.map(p => p.textWithPageMarker).join('')}</pre></div>
                            ) : (
                              <div className="flex-1 flex items-center justify-center p-8 text-gray-400 text-sm">텍스트가 없습니다.</div>
                            )}
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex flex-col bg-white overflow-hidden">
                            {openSourceTranslating ? (
                              <div className="flex-1 flex flex-col items-center justify-center p-8 text-gray-500">
                                <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-3" />
                                <p className="text-sm font-medium">LibreTranslate 번역 중...</p>
                                <p className="text-xs mt-1 text-gray-400">{processingStatus}</p>
                              </div>
                            ) : openSourceTranslations && openSourceTranslations.length > 0 ? (
                              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                                {openSourceTranslations.map((p) => (
                                  <div key={p.pageIndex} className="rounded-lg border border-gray-200 bg-green-50/30 p-4">
                                    <div className="text-xs font-bold text-gray-500 mb-2">--- Page {p.pageIndex} (오픈소스 번역) ---</div>
                                    <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{p.translated || '(번역 없음)'}</pre>
                                  </div>
                                ))}
                              </div>
                            ) : extractedPageTexts && extractedPageTexts.length > 0 ? (
                              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {extractedPageTexts.map((p) => (
                                  <div key={`opensource-page-${p.pageIndex}`} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                    <div className="px-4 py-2 border-b border-gray-200 bg-slate-50 flex items-center justify-between">
                                      <span className="text-xs font-bold text-gray-600">--- Page {p.pageIndex} ---</span>
                                      <button
                                        onClick={() => handleOpenGoogleTranslateForPage(p.pageIndex)}
                                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-md"
                                      >
                                        Google번역으로 보내기
                                      </button>
                                    </div>
                                    <pre className="p-4 text-xs text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{p.text || '(no text)'}</pre>
                                  </div>
                                ))}
                                <div className="pt-2 text-right">
                                  <button onClick={handleOpenGoogleTranslate} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow text-sm">
                                    전체 원문 Google 번역으로 열기
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex-1 flex items-center justify-center p-8 text-gray-400 text-sm">먼저 원본(text) 탭에서 원문 추출을 완료하세요.</div>
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
                                      <button onClick={() => { setShowPdfWindow(true); setHasStarted(true); }} disabled={isProcessing} className="w-full py-4 bg-gray-900 hover:bg-black text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed">
                                         {isProcessing ? <>Processing...</> : <>입장하기</>}
                                       </button>
                                       <div className="relative">
                                          <div className="absolute inset-0 flex items-center" aria-hidden="true"><div className="w-full border-t border-gray-200"></div></div>
                                          <div className="relative flex justify-center"><span className="px-2 bg-white text-xs text-gray-400">OR SELECT PAGES</span></div>
                                        </div>
                                      <div className="flex gap-2 flex-wrap items-center">
                                          <input type="text" placeholder="e.g. 1-2 (Default: 1-2)" value={pageRange} onChange={(e) => setPageRange(e.target.value)} className="flex-1 min-w-0 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 p-2.5 text-center outline-none" />
                                      <button onClick={() => { handleTranslate(false); }} disabled={isProcessing} className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50 text-sm">[차례로]</button>
                                      <button onClick={() => { handleTranslate(true); }} disabled={isProcessing} className="px-4 py-2.5 bg-gray-100 border border-gray-300 text-gray-600 font-medium rounded-lg hover:bg-gray-200 transition-colors shadow-sm disabled:opacity-50 text-sm">[Full extract]</button>
                                      </div>
                                  </div>
                                </div>
                            </div>
                            <button onClick={handleRemoveFile} className="mt-8 text-xs text-red-500 hover:text-red-700 underline text-center block w-full">Cancel & Upload Different File</button>
                       </div>
                  </div>
              </div>
            ) : hasStarted && startedView === 'sourceTranslate' ? (
              <div className="flex w-full h-full">
                 <SidebarNav totalPages={totalPages} processedPages={processedPageIndices} segments={segments} onPageClick={handleSidebarPageClick} onHeadingClick={handleSidebarHeadingClick} isProcessing={isProcessing} isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen(!isSidebarOpen)} />
                 <div className="flex-1 flex min-w-0">
                   <div className="flex-1 flex flex-col border-r border-gray-200 overflow-hidden">
                     <div className="flex-shrink-0 px-4 py-2 border-b border-gray-200 bg-gray-50 font-bold text-sm text-gray-700">원문</div>
                     <div ref={originalScrollRef} onScroll={() => syncScrollByRatio('original')} className="flex-1 overflow-y-auto p-4">
                       {extractedPageTexts && extractedPageTexts.length > 0 ? (
                         extractedPageTexts.map(p => (
                          <div
                             key={p.pageIndex}
                             id={`page-container-${p.pageIndex}`}
                             data-sync-page={p.pageIndex}
                             className="mb-6 flex flex-col"
                             style={pageSyncHeights[p.pageIndex] ? { minHeight: `${pageSyncHeights[p.pageIndex]}px` } : undefined}
                           >
                             <div className="text-xs font-bold text-gray-500 mb-2">--- Page {p.pageIndex} ---</div>
                             {structuredOriginalBlocks?.[p.pageIndex]?.length ? (
                               <div className="space-y-3">
                                 {structuredOriginalBlocks[p.pageIndex].map((block, blockIdx) => (
                                   <div
                                     key={`${p.pageIndex}-${blockIdx}`}
                                     className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed bg-white p-3 rounded border border-gray-100"
                                   >
                                     {block}
                                   </div>
                                 ))}
                               </div>
                             ) : (
                               <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed bg-white p-3 rounded border border-gray-100">{p.text || '(no text)'}</pre>
                             )}
                           </div>
                         ))
                       ) : extractTextError ? <p className="text-gray-500 text-sm">{extractTextError}</p> : <p className="text-gray-400 text-sm">원문 추출 중이거나 텍스트가 없습니다.</p>}
                       {structuringOriginal && <p className="text-xs text-primary-600 mt-3">AI가 줄바꿈을 복원하고 문단 블록으로 정리 중입니다...</p>}
                       {structuringError && <p className="text-xs text-amber-700 mt-2">{structuringError}</p>}
                     </div>
                   </div>
                  <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
                    <div className="flex-shrink-0 px-4 py-2 border-b border-gray-200 bg-slate-100 font-bold text-sm text-gray-700 flex items-center justify-between">
                      <span>AI페이지번역</span>
                      <button
                        onClick={() => setIsPageScrollSyncOn((prev) => !prev)}
                        className={`text-xs px-2.5 py-1 rounded border transition-colors ${isPageScrollSyncOn ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-gray-500 border-gray-300'}`}
                      >
                        {isPageScrollSyncOn ? 'Sync ON' : 'Sync OFF'}
                      </button>
                    </div>
                    <div ref={aiScrollRef} onScroll={() => syncScrollByRatio('ai')} className="flex-1 overflow-y-auto p-4">
                      {pageTranslating ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm">
                          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-3" />
                          <p>AI 통번역 백그라운드 실행 중...</p>
                          {processingStatus && <p className="text-xs text-gray-400 mt-1">{processingStatus}</p>}
                        </div>
                      ) : pageTranslations && Object.keys(pageTranslations).length > 0 ? (
                        extractedPageTexts?.map((p) => (
                          <div
                            key={`ai-${p.pageIndex}`}
                            data-sync-page={p.pageIndex}
                            className="mb-6 flex flex-col"
                            style={pageSyncHeights[p.pageIndex] ? { minHeight: `${pageSyncHeights[p.pageIndex]}px` } : undefined}
                          >
                            <div className="text-xs font-bold text-gray-500 mb-2">--- Page {p.pageIndex} (AI 번역) ---</div>
                            <div className="space-y-3">
                              {(pageTranslations[p.pageIndex] || []).map((block, idx) => (
                                <div key={`ai-${p.pageIndex}-${idx}`} className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed bg-white p-3 rounded border border-gray-100">
                                  {block}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm">
                          <p>상단 메뉴의 [페이지번역] 버튼을 누르면 AI 통번역이 시작됩니다.</p>
                          {pageTranslationError && <p className="text-xs text-amber-700 mt-2">{pageTranslationError}</p>}
                        </div>
                      )}
                    </div>
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
                        pageTranslations={pageTranslations}
                        structuredOriginalBlocks={structuredOriginalBlocks}
                        extractedPageTexts={extractedPageTexts}
                        onRequestPageTranslate={handlePageTranslate}
                      />
                 </div>
              </div>
            ) }
          </div>
        )}

        {/* Right Session Sidebar */}
        <>
          {showSessionSidebar && (
            <div className="absolute right-0 top-16 bottom-0 z-40 w-80 bg-white border-l border-gray-200 shadow-2xl flex flex-col">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">저장/불러오기</h3>
                    <p className="text-xs text-gray-500 mt-1">IndexedDB 및 .stp 파일 관리</p>
                  </div>
                  <button
                    onClick={() => setShowSessionSidebar(false)}
                    className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white text-gray-600 hover:bg-gray-100"
                    title="사이드 메뉴 닫기"
                  >
                    X
                  </button>
                </div>

                <div className="p-3 space-y-2 border-b border-gray-100">
                  <button onClick={handleSaveToIndexedDb} disabled={sessionBusy} className="w-full text-left px-3 py-2 text-xs bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50">현재 상태 IndexedDB 저장</button>
                  <button onClick={() => refreshSessionRecords()} disabled={sessionBusy} className="w-full text-left px-3 py-2 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">저장 목록 새로고침</button>
                  <button onClick={handleExportStp} disabled={sessionBusy} className="w-full text-left px-3 py-2 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">.stp 프로젝트 파일 내보내기</button>
                  <button onClick={() => stpFileInputRef.current?.click()} disabled={sessionBusy} className="w-full text-left px-3 py-2 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">.stp 프로젝트 파일 불러오기</button>
                  {sessionStatus && <p className="text-[11px] text-gray-500">{sessionStatus}</p>}
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {sessionRecords.length === 0 ? (
                    <p className="text-xs text-gray-400">저장된 세션이 없습니다.</p>
                  ) : (
                    sessionRecords.map((record) => (
                      <div key={record.id} className="border border-gray-200 rounded-lg p-2 bg-white">
                        <p className="text-xs font-medium text-gray-700 truncate" title={record.title}>{record.title}</p>
                        <p className="text-[10px] text-gray-400 mt-1">{new Date(record.updatedAt).toLocaleString()}</p>
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => handleLoadFromIndexedDb(record.id)} className="flex-1 px-2 py-1 text-[11px] rounded border border-primary-300 text-primary-700 hover:bg-primary-50">불러오기</button>
                          <button onClick={() => handleDeleteSession(record.id)} className="px-2 py-1 text-[11px] rounded border border-red-300 text-red-600 hover:bg-red-50">삭제</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
          )}
          <input ref={stpFileInputRef} type="file" accept=".stp,application/json" className="hidden" onChange={handleImportStpFile} />
        </>
        
        {isProcessing && segments.length === 0 && !hasStarted && (
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
