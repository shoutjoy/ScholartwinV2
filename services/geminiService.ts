
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { PaperAnalysisResult, SegmentType, TranslationTone, VocabularyItem, ConclusionSummary, PaperSegment, ExtractedFigure, AISettings, ChatMessage, PaperMetadata } from "../types";
import { cropImageFromCanvas, PageImage } from "./fileHelper";

const SETTINGS_KEY = 'scholar_ai_settings_v2';
// CHANGED: Default to Flash for speed as requested
const DEFAULT_TEXT_MODEL = 'gemini-3-flash-preview'; 
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'; 

export const getStoredSettings = (): AISettings => {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    return {
        activeProvider: parsed.activeProvider || 'gemini',
        apiKey: parsed.apiKey || '',
        textModel: parsed.textModel || DEFAULT_TEXT_MODEL,
        imageModel: parsed.imageModel || DEFAULT_IMAGE_MODEL,
        externalProviderName: parsed.externalProviderName || 'ChatGPT',
        externalApiKey: parsed.externalApiKey || '',
        externalModel: parsed.externalModel || 'gpt-4o'
    };
  }
  return {
    activeProvider: 'gemini',
    apiKey: '',
    textModel: DEFAULT_TEXT_MODEL,
    imageModel: DEFAULT_IMAGE_MODEL,
    externalProviderName: 'ChatGPT',
    externalApiKey: '',
    externalModel: 'gpt-4o'
  };
};

export const saveSettings = (settings: AISettings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

const getAiClient = () => {
  const settings = getStoredSettings();
  const apiKey = settings.apiKey || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found. Please set settings or environment variable.");
  }
  return new GoogleGenAI({ apiKey });
};

// 1. Analyze Metadata
export const analyzePaperMetadata = async (firstPageBase64: string): Promise<PaperMetadata> => {
  const ai = getAiClient();
  const settings = getStoredSettings();
  
  const prompt = `Extract metadata. JSON: title, authors, year, journal, volumeIssue, pages, doi.`;
  
  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
        title: { type: Type.STRING },
        authors: { type: Type.ARRAY, items: { type: Type.STRING } },
        year: { type: Type.STRING },
        journal: { type: Type.STRING },
        volumeIssue: { type: Type.STRING },
        pages: { type: Type.STRING },
        doi: { type: Type.STRING }
    },
    required: ["title", "authors", "year"]
  };

  try {
      const response = await ai.models.generateContent({
          model: settings.textModel,
          contents: {
              parts: [
                  { inlineData: { mimeType: 'image/jpeg', data: firstPageBase64 } },
                  { text: prompt }
              ]
          },
          config: { responseMimeType: "application/json", responseSchema: responseSchema }
      });
      return JSON.parse(response.text || "{}");
  } catch (e) {
      console.warn("Metadata extraction failed", e);
      return { title: "Unknown Paper", authors: [], year: "", journal: "" };
  }
};

// 2. Analyze Content Page by Page (Fixed Schema Robustness)
export const analyzePageContent = async (
    pageImageBase64: string, 
    pageIndex: number, 
    tone: TranslationTone
): Promise<PaperSegment[]> => {
    const ai = getAiClient();
    const settings = getStoredSettings();

    const toneInstruction = tone === TranslationTone.ACADEMIC 
    ? "Translate using formal academic Korean (~이다). Use specialized terminology. Headings use Noun endings (e.g., '서론')." 
    : "Translate using easy, explanatory Korean style (~해요).";

    const prompt = `
      You are an expert academic paper parser.
      Task: Analyze Page ${pageIndex + 1}.

      **CRITICAL READING ORDER**:
      1. This is a multi-column academic paper.
      2. You MUST read the **LEFT COLUMN** completely from top to bottom first.
      3. Then read the **RIGHT COLUMN** from top to bottom.
      4. DO NOT jump between columns. Follow the natural reading flow.

      **Content Extraction Rules**:

      1. **CODE & PROGRAM OUTPUTS** (Type: 'code'):
         - Extract source code blocks.
         - **CRITICAL**: Preserve ALL comments exactly (lines starting with #, //). DO NOT remove lines like "# using default...".
         - **CRITICAL**: Treat Program Outputs, Model Fit Statistics, Loglikelihood lists, or mono-spaced logs as 'code'. 
         - **NEGATIVE CONSTRAINT**: Do NOT treat program outputs/logs as 'table'.

      2. **FIGURE CAPTIONS** (Type: 'figure_caption'):
         - Extract lines starting with "Figure X", "Fig. X".
         - Include the full caption text (e.g., "Figure 3. Theory of Planned behaviour.").
         - Place them exactly where they appear in the flow.

      3. **TABLES** (Type: 'table'):
         - Only treat explicit data grids labeled as "Table X" as tables.
         - **CRITICAL**: Include the Table Title (e.g., "Table 1. Estimates...") in the 'original' text or as a separate 'text' segment before the table.
         - Convert table body to Markdown format.

      4. **TEXT & OTHERS**:
         - **heading**: Section titles (Intro, Methods...).
         - **abstract**: The abstract block.
         - **text**: Normal body paragraphs.
         - **equation**: Math formulas (LaTeX syntax).
         - **reference**: Bibliography items.

      **Translation**:
      - ${toneInstruction}
      - Do NOT translate Code, Program Outputs, or Variable names.
      - Translate Figure Captions and Table Titles.
      
      Output JSON 'segments'. Each segment:
      - id: unique string
      - type: string (text, heading, abstract, figure_caption, equation, table, code)
      - original: extracted source text (English)
      - translated: Korean translation
      - citations: array of extracted citation strings
    `;

    // Relaxed Schema: 'type' is STRING to prevent enum validation crashes if model hallucinates a type
    const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
            segments: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING },
                        type: { type: Type.STRING }, 
                        original: { type: Type.STRING },
                        translated: { type: Type.STRING },
                        citations: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["type", "original", "translated"]
                }
            }
        }
    };

    try {
        const response = await ai.models.generateContent({
            model: settings.textModel,
            contents: {
                parts: [
                    { inlineData: { mimeType: 'image/jpeg', data: pageImageBase64 } },
                    { text: prompt }
                ]
            },
            config: { responseMimeType: "application/json", responseSchema: responseSchema }
        });
        
        let result;
        try {
            let rawText = response.text || "{}";
            rawText = rawText.replace(/```json/g, '').replace(/```/g, '');
            result = JSON.parse(rawText);
        } catch (parseError) {
            console.error("JSON Parse Error", parseError);
            throw new Error("Failed to parse AI response");
        }

        return (result.segments || []).map((s: any, idx: number) => ({
            ...s,
            id: `pg${pageIndex}_${idx}_${Date.now()}`,
            pageIndex: pageIndex + 1, // Store 1-based page index
            type: validateSegmentType(s.type)
        }));
    } catch (e) {
        console.error(`Error analyzing page ${pageIndex}:`, e);
        return [{
            id: `err_${pageIndex}`,
            pageIndex: pageIndex + 1,
            type: SegmentType.TEXT,
            original: `[Error processing Page ${pageIndex + 1}]`,
            translated: `[페이지 ${pageIndex + 1} 처리 중 오류가 발생했습니다. 재시도 해주세요.]`,
            citations: []
        }];
    }
};

const validateSegmentType = (typeStr: string): SegmentType => {
    const t = typeStr.toLowerCase();
    if (t.includes('head')) return SegmentType.HEADING;
    if (t.includes('abstract')) return SegmentType.ABSTRACT;
    if (t.includes('fig') || t.includes('cap')) return SegmentType.FIGURE_CAPTION;
    if (t.includes('eq') || t.includes('math')) return SegmentType.EQUATION;
    if (t.includes('tab')) return SegmentType.TABLE;
    if (t.includes('code')) return SegmentType.CODE;
    return SegmentType.TEXT;
};

// ... (Rest of the functions remain the same)
export const analyzePdf = async (base64Pdf: string, tone: TranslationTone): Promise<PaperAnalysisResult> => {
   throw new Error("Please use page-by-page analysis (analyzePageContent) for full documents.");
};

export const structureOriginalTextIntoBlocks = async (rawText: string): Promise<string[]> => {
  const cleaned = (rawText || "").trim();
  if (!cleaned) return [];

  const ai = getAiClient();
  const settings = getStoredSettings();
  const prompt = `
    You are cleaning OCR/PDF extracted academic text.
    The text may contain hard line breaks in the middle of sentences.

    Task:
    1) Reconnect wrapped lines into normal sentences.
    2) Split the content into readable paragraph blocks.
    3) Preserve original language and meaning. Do NOT translate.
    4) Keep equations, table-like lines, and list items intact as much as possible.

    Return JSON only: { "blocks": ["paragraph 1", "paragraph 2", ...] }

    INPUT:
    ${cleaned}
  `;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      blocks: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    },
    required: ["blocks"]
  };

  try {
    const response = await ai.models.generateContent({
      model: settings.textModel,
      contents: { text: prompt },
      config: {
        responseMimeType: "application/json",
        responseSchema
      }
    });
    const text = response.text || '{"blocks":[]}';
    const parsed = JSON.parse(text);
    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    return blocks.map((b: string) => (b || "").trim()).filter(Boolean);
  } catch (error) {
    // Fallback: simple local paragraph split when AI structuring is unavailable.
    return cleaned
      .split(/\n\s*\n/g)
      .map((p) => p.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim())
      .filter(Boolean);
  }
};

export const translatePlainTextToKorean = async (text: string): Promise<string> => {
  const source = (text || "").trim();
  if (!source) return "";

  const ai = getAiClient();
  const settings = getStoredSettings();

  const prompt = `
You are a professional academic translator.
Translate the following English text into natural Korean.

Rules:
1) Preserve original meaning accurately.
2) Keep equations, inline symbols, citations, and code-like tokens as-is when appropriate.
3) Do not summarize. Do not omit content.
4) Return only translated Korean text.

Text:
${source}
  `;

  const response = await ai.models.generateContent({
    model: settings.textModel,
    contents: { text: prompt }
  });

  return (response.text || "").trim();
};

const LIST_DELIMITER = '\n⫽\n'; // unlikely to appear in content

/** Translate multiple texts in one call; returns array in same order. Delimiter is preserved in output. */
export const translateLinesToKorean = async (lines: string[]): Promise<string[]> => {
  if (!lines.length) return [];
  const single = lines.join(LIST_DELIMITER).trim();
  if (!single) return lines.map(() => '');
  const prompt = `
You are a professional academic translator.
Translate the following English text into natural Korean.
IMPORTANT: Keep the exact delimiter "${LIST_DELIMITER}" between each translated segment. Do not add or remove delimiters.
Return only the translated text with the same number of segments.

Text:
${single}
  `;
  const ai = getAiClient();
  const settings = getStoredSettings();
  const response = await ai.models.generateContent({
    model: settings.textModel,
    contents: { text: prompt }
  });
  const out = (response.text || '').trim();
  const translated = out.split(LIST_DELIMITER).map(s => s.trim());
  while (translated.length < lines.length) translated.push('');
  return translated.slice(0, lines.length);
};

export const explainBlockContent = async (originalText: string, translatedText: string, userPrompt?: string): Promise<{korean: string, english: string}> => {
  const ai = getAiClient();
  const settings = getStoredSettings();
  
  let promptText = `
    You are a professor explaining an academic paper.
    Original Text: "${originalText}"
    
    Provide a detailed explanation. If it's code/math, explain the syntax/variables.
    Output format: JSON { "korean": "...", "english": "..." }
  `;

  if (userPrompt) {
      promptText = `
        You are an helpful academic tutor.
        User Question: "${userPrompt}"
        
        Context (Original): "${originalText}"
        Context (Translated): "${translatedText}"
        
        Answer the question based on the context.
        Output format: JSON { "korean": "...", "english": "..." }
      `;
  }

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      korean: { type: Type.STRING },
      english: { type: Type.STRING }
    },
    required: ["korean", "english"]
  };

  const response = await ai.models.generateContent({
    model: settings.textModel,
    contents: { text: promptText },
    config: {
      responseMimeType: "application/json",
      responseSchema: responseSchema
    }
  });

  const text = response.text;
  if (!text) return { korean: "Error", english: "Error" };
  return JSON.parse(text);
};

export const extractVocabulary = async (segments: PaperSegment[]): Promise<VocabularyItem[]> => {
  const ai = getAiClient();
  const settings = getStoredSettings();
  const contextText = segments.map(s => s.original).join("\n").slice(0, 30000); 

  const prompt = `Extract 5-10 key academic terms with definitions (Korean) and context.`;

  const responseSchema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        term: { type: Type.STRING },
        definition: { type: Type.STRING },
        context: { type: Type.STRING }
      },
      required: ["term", "definition", "context"]
    }
  };

  const response = await ai.models.generateContent({
    model: settings.textModel, 
    contents: [{ text: contextText }, { text: prompt }],
    config: {
      responseMimeType: "application/json",
      responseSchema: responseSchema
    }
  });

  const text = response.text;
  return text ? JSON.parse(text) : [];
};

export const explainTermWithGrounding = async (term: string): Promise<string> => {
  const ai = getAiClient();
  const settings = getStoredSettings();
  const prompt = `Explain "${term}" in Korean for a graduate student with academic sources.`;

  const response = await ai.models.generateContent({
    model: settings.textModel,
    contents: prompt,
    config: { tools: [{ googleSearch: {} }] }
  });

  let content = response.text || "설명을 찾을 수 없습니다.";
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (chunks) {
    const links = chunks.map((c: any) => c.web?.uri ? `[source](${c.web.uri})` : null).filter(Boolean).join(', ');
    if (links) content += `\n\n참고자료: ${links}`;
  }
  return content;
};

export const generateConclusion = async (segments: PaperSegment[]): Promise<ConclusionSummary> => {
  const ai = getAiClient();
  const settings = getStoredSettings();
  const contextText = segments.map(s => s.original).join("\n").slice(0, 50000); 
  const prompt = `Summarize conclusion: Research Questions, Key Results, Implications. Tone: Academic.`;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      researchQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
      results: { type: Type.ARRAY, items: { type: Type.STRING } },
      implications: { type: Type.ARRAY, items: { type: Type.STRING } }
    }
  };

  const response = await ai.models.generateContent({
    model: settings.textModel,
    contents: [{ text: contextText }, { text: prompt }],
    config: { responseMimeType: "application/json", responseSchema: responseSchema }
  });

  const text = response.text;
  if (!text) throw new Error("No conclusion generated");
  return JSON.parse(text);
};

export const generatePresentationScript = async (segments: PaperSegment[]): Promise<string> => {
  const ai = getAiClient();
  const settings = getStoredSettings();
  const buildBalancedPageContext = (items: PaperSegment[], maxTotalChars: number = 50000, maxPerPageChars: number = 3500) => {
    const grouped = new Map<number, PaperSegment[]>();
    for (const seg of items) {
      const key = seg.pageIndex || 1;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(seg);
    }

    const pageKeys = Array.from(grouped.keys()).sort((a, b) => a - b);
    const chunks: string[] = [];
    let total = 0;

    for (const page of pageKeys) {
      const raw = (grouped.get(page) || [])
        .map((s) => `[${s.type}] ${s.original}`)
        .join('\n')
        .slice(0, maxPerPageChars);

      if (!raw.trim()) continue;
      const withHeader = `\n--- Page ${page} ---\n${raw}\n`;
      if (total + withHeader.length > maxTotalChars) break;
      chunks.push(withHeader);
      total += withHeader.length;
    }
    return chunks.join('\n').trim();
  };

  const contextText = buildBalancedPageContext(segments);
  
  const prompt = `
    Based on the provided academic paper content, create a presentation script for a PPT.
    IMPORTANT: Use key points from all provided pages in order, not only the first page.
    
    Structure the output as follows for each slide:
    ---
    ## Slide [Number]: [Title]
    **Key Points (Bullet Points):**
    - [Point 1]
    - [Point 2]
    
    **Speaker Notes (Script for the presenter):**
    [Natural, engaging script in Korean ~입니다/합니다 style explaining the slide content]
    ---
    
    Cover: Title, Intro, Methodology, Key Results, Discussion, Conclusion.
  `;

  const response = await ai.models.generateContent({
    model: settings.textModel,
    contents: [{ text: contextText }, { text: prompt }]
  });

  return response.text || "Failed to generate script.";
};

export const findReferenceDetails = async (citation: string, fullTextContext: string): Promise<string> => {
  const ai = getAiClient();
  const settings = getStoredSettings();
  const prompt = `Find full bibliographic reference for "${citation}" in text. Return only the string.`;
  const response = await ai.models.generateContent({
    model: settings.textModel,
    contents: [{ text: `Context: ${fullTextContext.slice(-20000)}` }, { text: prompt }] 
  });
  return response.text || "";
};

export const chatWithPaper = async (history: ChatMessage[], newMessage: string, segments: PaperSegment[]): Promise<string> => {
    const ai = getAiClient();
    const settings = getStoredSettings();
    
    const context = segments.slice(0, 200).map(s => s.original).join('\n').slice(0, 30000);
    
    const systemInstruction = `
      You are an academic assistant helping a user understand a research paper.
      Answer questions based on the provided PAPER CONTEXT.
      
      PAPER CONTEXT:
      ${context}
    `;

    // Construct contents from history + new message
    const contents = history.map(msg => {
       const parts: any[] = [{ text: msg.text }];
       if (msg.attachment) {
           parts.unshift({
               inlineData: {
                   mimeType: msg.attachment.mimeType,
                   data: msg.attachment.data
               }
           });
       }
       return { role: msg.role, parts };
    });

    if (newMessage && newMessage.trim() !== '') {
        contents.push({ role: 'user', parts: [{ text: newMessage }] });
    }

    const response = await ai.models.generateContent({
        model: settings.textModel,
        config: { systemInstruction },
        contents: contents
    });

    return response.text || "No response.";
};
