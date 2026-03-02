
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { VocabularyItem, ConclusionSummary } from '../types';
import { explainTermWithGrounding, generatePresentationScript, translatePlainTextToKorean } from '../services/geminiService';
import { downloadText, openInNewWindow } from '../services/fileHelper';
import { saveSessionRecord, listSessionRecords, getSessionRecord } from '../services/sessionStoreService';

interface ToolsPanelProps {
  vocabulary: VocabularyItem[];
  conclusion: ConclusionSummary | null;
  onClose: () => void;
  onGenerateVocab: () => void;
  onGenerateConclusion: () => void;
  isProcessing: boolean;
  onUpdateVocabItem: (index: number, item: VocabularyItem) => void;
  
  // New prop can be implicit if we move generation logic here, but segments needed
  // For simplicity, let's assume we might need to pass segments down or handle it in App. 
  // Wait, ToolsPanel doesn't have segments. 
  // I will assume for now we only show the UI here and pass a handler "onGeneratePPT" from App.
  // Actually, let's just make sure we pass the handler from App.tsx. 
  // I'll update the interface to accept the handler.
}

// Extend props to include onGeneratePPT
interface ExtendedToolsPanelProps extends ToolsPanelProps {
    onGeneratePPT?: () => Promise<string>;
}

type Tab = 'explore' | 'conclusion' | 'ppt';

const ToolsPanel: React.FC<ExtendedToolsPanelProps> = ({ 
  vocabulary, 
  conclusion, 
  onClose,
  onGenerateVocab,
  onGenerateConclusion,
  isProcessing,
  onUpdateVocabItem,
  onGeneratePPT
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('explore');
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const [loadingTerm, setLoadingTerm] = useState<string | null>(null);
  const [pptScript, setPptScript] = useState<string | null>(null);
  const [pptScriptKo, setPptScriptKo] = useState<string | null>(null);
  const [pptLang, setPptLang] = useState<'en' | 'ko'>('en');
  const [isGeneratingPPT, setIsGeneratingPPT] = useState(false);
  const [dbStatus, setDbStatus] = useState('');

  const handleSaveGeneratedToDb = async () => {
    try {
      const now = new Date().toISOString();
      await saveSessionRecord({
        id: `tools-${Date.now()}`,
        title: `tools-panel-${new Date().toLocaleString()}`,
        createdAt: now,
        updatedAt: now,
        payload: {
          type: 'tools-panel-generated',
          vocabulary,
          conclusion,
          pptScript,
          pptScriptKo
        }
      });
      setDbStatus('생성 결과를 IndexedDB에 저장했습니다.');
    } catch (error: any) {
      setDbStatus(`저장 실패: ${error?.message || 'unknown error'}`);
    }
  };

  const handleLoadGeneratedFromDb = async () => {
    try {
      const all = await listSessionRecords();
      const latestTools = all.find((r) => r.payload?.type === 'tools-panel-generated');
      if (!latestTools) {
        setDbStatus('불러올 생성 결과가 없습니다.');
        return;
      }
      const record = await getSessionRecord(latestTools.id);
      const payload = record?.payload || {};
      if (payload.pptScript) setPptScript(payload.pptScript);
      if (payload.pptScriptKo) setPptScriptKo(payload.pptScriptKo);
      setDbStatus('최근 생성 결과를 불러왔습니다.');
    } catch (error: any) {
      setDbStatus(`불러오기 실패: ${error?.message || 'unknown error'}`);
    }
  };

  const handleExplainTerm = async (index: number, item: VocabularyItem) => {
    if (expandedTerm === item.term && item.aiExplanation) {
      setExpandedTerm(null); // Collapse
      return;
    }
    
    setExpandedTerm(item.term);
    
    if (item.aiExplanation) return;

    setLoadingTerm(item.term);
    try {
      const explanation = await explainTermWithGrounding(item.term);
      onUpdateVocabItem(index, { ...item, aiExplanation: explanation });
    } catch (e) {
      alert("Failed to fetch explanation.");
    } finally {
      setLoadingTerm(null);
    }
  };

  const handleDownloadVocab = () => {
    if (vocabulary.length === 0) return;
    const txt = vocabulary.map(v => 
      `Term: ${v.term}\nDefinition: ${v.definition}\nContext: ${v.context}\n${v.aiExplanation ? `AI Analysis:\n${v.aiExplanation}\n` : ''}-------------------`
    ).join('\n');
    downloadText('explore_ai_vocabulary.txt', txt);
  };

  const handleDownloadConclusion = () => {
    if (!conclusion) return;
    const txt = `RESEARCH QUESTIONS:\n${conclusion.researchQuestions.join('\n- ')}\n\nKEY RESULTS:\n${conclusion.results.join('\n- ')}\n\nIMPLICATIONS:\n${conclusion.implications.join('\n- ')}`;
    downloadText('paper_conclusion.txt', txt);
  };

  const handlePPTGeneration = async () => {
      if (!onGeneratePPT) return;
      setIsGeneratingPPT(true);
      setPptScriptKo(null);
      try {
          const script = await onGeneratePPT();
          setPptScript(script);
          if (script && script.trim()) {
            const scriptKo = await translatePlainTextToKorean(script);
            setPptScriptKo(scriptKo);
          }
      } catch (e) {
          alert("Failed to generate PPT script");
      } finally {
          setIsGeneratingPPT(false);
      }
  };

  const handleShowPPT = () => {
      const text = (pptLang === 'ko' && pptScriptKo) ? pptScriptKo : pptScript;
      if (text) openInNewWindow(text, pptLang === 'ko' ? 'Presentation Script (한국어)' : 'Presentation Script');
  };

  return (
    <div className="w-96 bg-white border-l border-gray-200 shadow-xl flex flex-col h-full absolute right-0 top-0 z-30">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs">AI</span>
          Study Assistant
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-2 border-b border-gray-100 bg-white flex items-center gap-2">
        <button onClick={handleSaveGeneratedToDb} className="text-[11px] px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">생성결과 저장</button>
        <button onClick={handleLoadGeneratedFromDb} className="text-[11px] px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">생성결과 불러오기</button>
      </div>
      {dbStatus && <div className="px-4 py-1 text-[11px] text-gray-500 border-b border-gray-100">{dbStatus}</div>}

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button 
          className={`flex-1 py-3 text-xs font-medium ${activeTab === 'explore' ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('explore')}
        >
          Explore
        </button>
        <button 
          className={`flex-1 py-3 text-xs font-medium ${activeTab === 'conclusion' ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('conclusion')}
        >
          Conclusion
        </button>
        <button 
          className={`flex-1 py-3 text-xs font-medium ${activeTab === 'ppt' ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('ppt')}
        >
          PPT Script
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'explore' && (
          <div className="space-y-4">
            {vocabulary.length === 0 ? (
               <div className="text-center mt-10">
                 <p className="text-gray-500 italic mb-4">Extract key terms using AI.</p>
                 <button 
                   onClick={onGenerateVocab}
                   disabled={isProcessing}
                   className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors shadow-sm disabled:bg-gray-400"
                 >
                   {isProcessing ? 'Analyzing...' : 'Explore theory'}
                 </button>
               </div>
            ) : (
              <>
                 <div className="flex justify-end mb-2">
                   <button onClick={handleDownloadVocab} className="text-xs text-gray-500 hover:text-primary-600 underline">Download TXT</button>
                 </div>
                 {vocabulary.map((item, idx) => (
                  <div key={idx} className="bg-white border border-gray-100 rounded-lg shadow-sm overflow-hidden">
                    <div className="p-3 bg-gray-50 flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-gray-900">{item.term}</h3>
                        {item.termKo && <p className="text-xs text-primary-600 mt-0.5">{item.termKo}</p>}
                        <p className="text-sm text-gray-600 mt-1">{item.definition}</p>
                        {item.definitionKo && <p className="text-xs text-gray-500 mt-0.5">{item.definitionKo}</p>}
                      </div>
                    </div>
                    <div className="px-3 py-2 border-t border-gray-100">
                      <p className="text-xs text-gray-400 italic mb-2">"{item.context}"</p>
                      {item.contextKo && <p className="text-xs text-gray-500 mb-2">"{item.contextKo}"</p>}
                      <button 
                        onClick={() => handleExplainTerm(idx, item)}
                        className="text-xs flex items-center gap-1 text-primary-600 hover:text-primary-800 font-medium"
                      >
                        {loadingTerm === item.term ? 'Searching Scholar...' : (item.aiExplanation ? 'View Deep Explanation' : 'Deep Explain with AI')}
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
                        </svg>
                      </button>
                      
                      {expandedTerm === item.term && item.aiExplanation && (
                        <div className="mt-2 p-2 bg-blue-50 text-xs text-slate-800 rounded border border-blue-100">
                          <ReactMarkdown>{item.aiExplanation}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === 'conclusion' && (
          <div>
            {!conclusion ? (
               <div className="text-center mt-10">
                 <p className="text-gray-500 italic mb-4">Summarize paper conclusion.</p>
                 <button 
                   onClick={onGenerateConclusion}
                   disabled={isProcessing}
                   className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors shadow-sm disabled:bg-gray-400"
                 >
                   {isProcessing ? 'Summarizing...' : 'Generate Conclusion'}
                 </button>
               </div>
            ) : (
              <div className="space-y-6">
                <div className="flex justify-end mb-2">
                   <button onClick={handleDownloadConclusion} className="text-xs text-gray-500 hover:text-primary-600 underline">Download TXT</button>
                </div>
                <section>
                  <h3 className="font-bold text-primary-700 text-sm uppercase tracking-wide mb-2">Research Questions</h3>
                  <ul className="list-disc pl-4 text-sm space-y-1 text-gray-700">
                    {conclusion.researchQuestions.map((q, i) => (
                      <li key={i}>
                        {q}
                        {conclusion.researchQuestionsKo?.[i] && <span className="block text-xs text-primary-600 mt-0.5">{conclusion.researchQuestionsKo[i]}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="font-bold text-primary-700 text-sm uppercase tracking-wide mb-2">Key Results</h3>
                  <ul className="list-disc pl-4 text-sm space-y-1 text-gray-700">
                    {conclusion.results.map((r, i) => (
                      <li key={i}>
                        {r}
                        {conclusion.resultsKo?.[i] && <span className="block text-xs text-primary-600 mt-0.5">{conclusion.resultsKo[i]}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="font-bold text-primary-700 text-sm uppercase tracking-wide mb-2">Implications</h3>
                  <ul className="list-disc pl-4 text-sm space-y-1 text-gray-700">
                    {conclusion.implications.map((imp, i) => (
                      <li key={i}>
                        {imp}
                        {conclusion.implicationsKo?.[i] && <span className="block text-xs text-primary-600 mt-0.5">{conclusion.implicationsKo[i]}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            )}
          </div>
        )}

        {activeTab === 'ppt' && (
            <div className="space-y-4">
                {!pptScript ? (
                    <div className="text-center mt-10">
                        <p className="text-gray-500 italic mb-4">Generate a presentation script based on the paper.</p>
                        <button 
                            onClick={handlePPTGeneration}
                            disabled={isGeneratingPPT}
                            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors shadow-sm disabled:bg-gray-400"
                        >
                            {isGeneratingPPT ? 'Drafting Script...' : 'Create PPT Script'}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-3">
                         <div className="flex gap-2 justify-center">
                             <button onClick={() => downloadText('presentation_script.txt', pptScript)} className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-bold">
                                 Download .txt
                             </button>
                             {pptScriptKo && (
                             <button onClick={() => downloadText('presentation_script_ko.txt', pptScriptKo)} className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-bold">
                                 한국어 .txt
                             </button>
                             )}
                             <button onClick={handleShowPPT} className="flex-1 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-bold">
                                 Open in New Window
                             </button>
                         </div>
                         <div className="flex border-b border-gray-200 mb-2">
                           <button type="button" onClick={() => setPptLang('en')} className={`flex-1 py-2 text-xs font-medium ${pptLang === 'en' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}>영문</button>
                           <button type="button" onClick={() => setPptLang('ko')} className={`flex-1 py-2 text-xs font-medium ${pptLang === 'ko' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}>한국어</button>
                         </div>
                         <div className="p-3 bg-gray-50 rounded border border-gray-200 text-xs font-mono h-[400px] min-h-[220px] max-h-[75vh] resize-y overflow-y-auto whitespace-pre-wrap">
                             {pptLang === 'ko' && pptScriptKo != null ? pptScriptKo : pptScript}
                         </div>
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
};

export default ToolsPanel;
