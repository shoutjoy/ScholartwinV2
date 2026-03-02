# ScholarTwin 개발 이력 (dev_history.md)

이 문서는 ScholarTwin AI 프로젝트에서 논의·구현한 **개발 요구사항**과 **실제 개발 처리 내역**을 기록합니다.

---

## 1. PDF 원문 추출 기능 (파일에서 추출)

### 개발 요구
- PDF 업로드 시 **원문을 “파일에서 추출”**하는 기능 필요.
- **기본 방식**: `pdf.js`의 `page.getTextContent()`로 PDF 텍스트 레이어에서 **페이지별** 텍스트 추출.
- **추가 옵션**: 기존처럼 AI가 페이지 이미지를 읽어 추출하는 방식을 **설정에서 선택** 가능하게 할 것.
- 추출 시 **물리적 페이지 단위**로 하고, **페이지 표시**(예: `--- Page N ---`)를 넣어 **제대로 추출되었는지 확인**할 수 있게 할 것.

### 개발 처리
| 구분 | 파일 | 내용 |
|------|------|------|
| 원문 추출 API | `services/fileHelper.ts` | `extractTextFromPdfPages(file, maxPages)` 추가. `getTextContent()`로 페이지별 텍스트 추출 후, `ExtractedPageText` 형태로 `{ pageIndex, text, textWithPageMarker }` 반환. `textWithPageMarker`에 `\n--- Page N ---\n` 포함. |
| 타입 | `types.ts` | `ExtractionMethod = 'pdfTextLayer' \| 'aiVision'` 추가. `AISettings`에 `extractionMethod` 추가 (기본값 `'pdfTextLayer'`). |
| 설정 | `services/geminiService.ts` | `getStoredSettings()`에 `extractionMethod` 반영. `analyzePageContentFromText(pageTextWithMarker, pageIndex, tone)` 추가 — 추출된 원문만 받아 세그먼트·번역 수행. |
| 처리 분기 | `App.tsx` | `executeTranslation`에서 `extractionMethod`에 따라 분기: `pdfTextLayer` → `extractTextFromPdfPages` 후 `analyzePageContentFromText` 호출; `aiVision` → 기존 `renderPdfPagesToImages` + `analyzePageContent`. |

---

## 2. 설정에서 원문 추출 방식 선택

### 개발 요구
- **두 가지 추출 방식**에 대한 선택 키를 설정 화면에 추가.
  - **PDF 텍스트 레이어 (기본)**: 파일 내장 텍스트를 페이지별 추출.
  - **AI 이미지 분석**: 페이지를 이미지로 변환 후 AI가 읽어 추출 (스캔 PDF 등에 유리).

### 개발 처리
| 구분 | 파일 | 내용 |
|------|------|------|
| 설정 UI | `components/SettingsModal.tsx` | “원문 추출 방식” 섹션 추가. 라디오 두 개: “PDF 텍스트 레이어 (기본)”, “AI 이미지 분석”. `AISettings.extractionMethod` 저장/로드. |

---

## 3. 메인 버튼: 원문 추출 / 인공지능 추출 분리

### 개발 요구
- 기존 “Analyze Full Document (Default)”를 **원문 추출** 중심으로 변경.
- **메인 버튼**: 원문 추출(전체).
- **내부에** “인공지능 추출” 버튼을 별도로 두어, 사용자가 선택할 수 있게 할 것.

### 개발 처리
| 구분 | 파일 | 내용 |
|------|------|------|
| 핸들러 | `App.tsx` | `handleTranslate(isFull, forceExtractionMethod?)` 추가. `executeTranslation(..., forceExtractionMethod?)`로 한 번만 특정 방식 강제 실행 가능. |
| UI | `App.tsx` | 메인 버튼 문구: “원문 추출 (전체)”. 그 아래 “인공지능 추출 (전체)” 버튼 추가. 페이지 범위 영역: “원문 추출” / “인공지능” 버튼으로 범위별 원문 추출 vs AI 추출 선택. |

---

## 4. 파일 업로드 시 자동 추출 + PDF / Text 탭

### 개발 요구
- **파일을 올리면 추출 작업이 자동으로 시작**되도록 할 것.
- 화면을 **탭으로 나누어** **PDF**와 **Text(원문 추출)** 로 구분해 보여 줄 것.

### 개발 처리
| 구분 | 파일 | 내용 |
|------|------|------|
| 자동 추출 | `App.tsx` | `selectedFile` 설정 시 `extractTextFromPdfPages(selectedFile, 9999)` 백그라운드 실행. 결과를 `extractedPageTexts` 상태에 저장. `extractingText`, `extractTextError` 상태로 로딩/에러 표시. |
| 탭 UI | `App.tsx` | 세그먼트가 없을 때 미리보기 영역에 “PDF” / “Text (원문 추출)” 탭 추가. PDF 탭: 기존 PDF 미리보기. Text 탭: `extractedPageTexts`의 `textWithPageMarker`를 이어서 표시(페이지 표시로 확인 가능). |

---

## 5. 시작 페이지: APA, 제목, 초록, 시작하기만 노출

### 개발 요구
- **시작 페이지**에는 다음만 노출.
  - 논문의 **APA 정보**
  - **논문 제목**
  - **초록 부분**
  - **“시작하기” 버튼** 하나만
- 이 화면에서 **원문 추출 / 인공지능 추출** 관련 버튼은 모두 제거.

### 개발 처리
| 구분 | 파일 | 내용 |
|------|------|------|
| 상태 | `App.tsx` | `hasStarted` 상태 추가. 파일 선택 직후는 `hasStarted === false`로 시작 페이지 표시. |
| 메타데이터 로드 | `App.tsx` | 파일 선택 후 `extractedPageTexts`가 준비되면 첫 페이지 이미지로 `analyzePaperMetadata()` 호출해 APA·제목 등 메타데이터 설정. |
| 시작 페이지 UI | `App.tsx` | `selectedFile && !hasStarted`일 때: APA(메타데이터 기반), 제목(메타데이터 또는 파일명), 초록(첫 페이지 추출 텍스트에서 Abstract~Introduction 구간 또는 앞부분 1500자), “시작하기” 버튼만 렌더. |
| 시작하기 동작 | `App.tsx` | “시작하기” 클릭 시 `setShowPdfWindow(true)`, `setHasStarted(true)` → 문서 뷰(EX-TEXT / AI-TEXT)로 전환. |

---

## 6. 들어간 페이지: EX-TEXT / AI-TEXT 분리

### 개발 요구
- **들어간 페이지**(시작하기 이후)에서는:
  - **EX-TEXT**: 자동 추출된 텍스트를 **블록**으로 만들어 배치. Text(원문 추출) 결과를 블록으로 표시.
  - **AI-TEXT**: 별도 영역으로 분리.
- AI-TEXT **메뉴 상단**에 다음 버튼 배치.
  - **[1~2p부터 번역]**: 처음 2페이지 분량 텍스트를 추출해 번역.
  - **[전체 번역]**: 전체를 한 번에 번역.
- 위 번역은 **백그라운드**에서 수행하고, **진행률**을 **왼쪽 상단에 %**로 표시.
- **문서를 계속 볼 수 있도록** 레이어가 내용을 가리지 않게 할 것(작은 진행률 표시만).

### 개발 처리
| 구분 | 파일 | 내용 |
|------|------|------|
| 진행률 표시 | `App.tsx` | `isProcessing`일 때 `main` 왼쪽 상단에 고정 위치(`absolute top-4 left-4`), 작은 패널로 `progress` %와 `processingStatus` 표시. `pointer-events-none`으로 클릭 방해 없음. |
| 문서 뷰 구조 | `App.tsx` | `hasStarted && segments.length === 0`일 때: 왼쪽 EX-TEXT(원문 추출 텍스트를 페이지별 블록으로 표시), 오른쪽 AI-TEXT(상단에 [1~2p부터 번역], [전체 번역] 버튼 + 번역 결과 또는 빈 상태). 기존 “Translation Style”, “Extraction Range”, 원문/인공지능 추출 버튼 제거. |

※ EX-TEXT 블록 배치 및 [1~2p부터 번역]/[전체 번역] 버튼이 문서 뷰에 완전히 반영된 상태는 현재 저장소와 대조해 확인이 필요할 수 있습니다.

---

## 7. 요약 표

| # | 개발 요구 | 개발 처리 요약 |
|---|-----------|----------------|
| 1 | PDF 원문을 파일에서 추출, 페이지 표시로 확인 | `fileHelper.extractTextFromPdfPages`, 페이지 마커 포함 반환 |
| 2 | 설정에서 PDF 텍스트 레이어 vs AI 이미지 분석 선택 | `SettingsModal`에 원문 추출 방식 라디오 추가 |
| 3 | 메인은 원문 추출, 내부에 인공지능 추출 버튼 | 메인 “원문 추출 (전체)”, 보조 “인공지능 추출 (전체)” 및 범위별 버튼, `forceExtractionMethod` 지원 |
| 4 | 업로드 시 자동 추출, PDF/Text 탭 | 업로드 시 `extractTextFromPdfPages` 실행, PDF / Text(원문 추출) 탭 UI |
| 5 | 시작 페이지: APA, 제목, 초록, 시작하기만 | `hasStarted`, 시작 페이지 전용 UI, 메타데이터·초록 자동 로드 |
| 6 | EX-TEXT / AI-TEXT 분리, [1~2p][전체] 번역, 진행률 % 왼쪽 상단 | 진행률 왼쪽 상단 고정 표시, 문서 뷰에서 EX-TEXT/AI-TEXT 구조 및 번역 버튼 설계·구현 |

---

## 8. 수정·추가된 주요 파일 목록

- `types.ts` — `ExtractionMethod`, `AISettings.extractionMethod`
- `services/fileHelper.ts` — `ExtractedPageText`, `extractTextFromPdfPages`, `getPdfPageCount`(cMap 옵션)
- `services/geminiService.ts` — `extractionMethod` 저장/로드, `analyzePageContentFromText`
- `components/SettingsModal.tsx` — 원문 추출 방식 선택 UI
- `App.tsx` — `hasStarted`, `extractedPageTexts`, `extractingText`, `extractTextError`, `previewTab`, 시작 페이지, PDF/Text 탭, 진행률 표시, 원문/인공지능 버튼, EX-TEXT/AI-TEXT 문서 뷰

---

## 9. 비고

- 현재 워크스페이스에 위 변경이 일부만 반영되어 있을 수 있습니다. `dev_history.md`를 기준으로 필요한 항목을 다시 적용하거나 diff로 비교해 보완할 수 있습니다.
- 스캔 PDF 등 텍스트 레이어가 없는 경우에는 설정에서 “AI 이미지 분석”을 선택하거나, 화면의 “인공지능 추출” 버튼을 사용하면 됩니다.

---

## 10. 최근 추가 개발 내역 (2026-03-02)

### 개발 요구
- PDF/원본 탭 우측에 **오픈소스 번역결과** 탭 추가.
- 시작 전 문서 뷰에서 원문 영역을 **문장 단위로 자연스럽게 복원한 블록** 형태로 표시.
- 왼쪽 패널에서 **Google 번역으로 열기** 버튼 제공(원문 전달 + 새 창 열기).
- 문서 뷰 오른쪽 영역을 **AI페이지번역**으로 개편하고, 상단 메뉴에 **[페이지번역]** 버튼 추가.
- 페이지 번역은 UI를 막지 않고 **백그라운드 비동기**로 동작.

### 개발 처리
| 구분 | 파일 | 내용 |
|------|------|------|
| 오픈소스 번역 탭 | `App.tsx` | `previewTab`에 `'opensource'` 추가, 탭 버튼 및 결과 화면(진행/완료/빈 상태) 구현. |
| LibreTranslate 서비스 | `services/libreTranslateService.ts` | `translateWithLibreTranslate`, `translatePagesWithLibreTranslate` 추가. 페이지 단위 번역 및 진행 콜백 지원. |
| 원문 AI 블록화 | `services/geminiService.ts`, `App.tsx` | `structureOriginalTextIntoBlocks(rawText)` 추가. 줄바꿈으로 잘린 문장을 복원해 문단 블록 배열로 반환하고, 원문 패널을 블록 렌더링으로 전환. |
| 페이지 AI 번역 | `services/geminiService.ts`, `App.tsx` | `translatePlainTextToKorean(text)` 추가. `[페이지번역]` 버튼으로 페이지/블록 순회 번역 수행, 상태(`pageTranslating`, `pageTranslations`) 기반으로 우측 패널 표시. |
| 우측 패널 개편 | `App.tsx` | 우측 헤더를 `AI페이지번역`으로 변경. 실행 중 로딩/상태 메시지, 완료 시 페이지별 번역 블록 출력. |
| Google 번역 연동 | `App.tsx` | `handleOpenGoogleTranslate()` 추가. 추출 원문을 URL 인코딩해 `https://translate.google.co.kr/?sl=en&tl=ko&op=translate`로 새 창 이동. |
| Tailwind 경고 정리 | `index.html`, `index.css`, `index.tsx`, `vite.config.ts`, `postcss.config.js`, `tailwind.config.js` | CDN 사용 제거, Vite 플러그인 기반 Tailwind(v4)로 전환, 커스텀 스타일을 `index.css`로 이동. |

### 참고 링크
- Google 번역: <https://translate.google.co.kr/?sl=en&tl=ko&op=translate>



