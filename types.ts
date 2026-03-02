
export enum TranslationTone {
  ACADEMIC = 'Academic (~이다)',
  EXPLANATORY = 'Explanatory (설명체)',
}

export enum SegmentType {
  TEXT = 'text',
  HEADING = 'heading',
  ABSTRACT = 'abstract', // Added for specific academic section styling
  FIGURE_CAPTION = 'figure_caption',
  EQUATION = 'equation',
  TABLE = 'table',
  CODE = 'code' 
}

export interface PaperMetadata {
  title: string;
  authors: string[];
  year: string;
  journal: string;
  volumeIssue?: string;
  pages?: string;
  doi?: string;
}

export interface PaperAnalysisResult {
  metadata: PaperMetadata;
  segments: PaperSegment[];
}

export interface PaperSegment {
  id: string;
  pageIndex: number; // Added: Track which page this belongs to
  type: SegmentType;
  original: string;
  translated: string;
  citations?: string[]; 
  // Dual language explanations
  explanation?: string; // Korean
  explanationEn?: string; // English
  isExplaining?: boolean; // Loading state
  
  // User Interactions
  isBookmarked?: boolean;
  userNote?: string;
}

export interface ExtractedFigure {
  id: string;
  pageIndex: number;
  base64: string; 
  title: string; 
  aiExplanation?: string; 
}

export interface VocabularyItem {
  term: string;
  definition: string;
  context: string;
  aiExplanation?: string; // Persisted explanation
  /** 한국어 번역 (생성 시 함께 생성) */
  termKo?: string;
  definitionKo?: string;
  contextKo?: string;
}

export interface ConclusionSummary {
  researchQuestions: string[];
  results: string[];
  implications: string[];
  /** 한국어 번역 (생성 시 함께 생성) */
  researchQuestionsKo?: string[];
  resultsKo?: string[];
  implicationsKo?: string[];
}

export interface ReferenceLink {
  citation: string;
  details: string;
  url?: string;
}

export interface ProcessingState {
  isUploading: boolean;
  isProcessing: boolean;
  progress: number; 
  error: string | null;
}

export interface User {
  id: string; 
  password?: string; 
  name: string;
  phone?: string;
  isPaid: boolean;
  isActive: boolean;
  isAdmin: boolean;
  provider: 'local' | 'google';
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
}

export type AIProvider = 'gemini' | 'external';

export interface AISettings {
  activeProvider: AIProvider;
  
  // Gemini Specific
  apiKey: string; 
  textModel: string; // e.g., gemini-3-pro-preview
  imageModel: string; // e.g., gemini-2.5-flash-image (Nano Banana)

  // External (e.g., ChatGPT)
  externalProviderName: string; // 'ChatGPT', 'Claude'
  externalApiKey: string;
  externalModel: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  attachment?: {
    mimeType: string;
    data: string; // base64
    name: string;
  };
}
