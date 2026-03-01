
import React, { useState, useEffect } from 'react';
import { AISettings, ExtractionMethod } from '../types';
import { getStoredSettings, saveSettings } from '../services/geminiService';

interface SettingsModalProps {
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<AISettings>({
    activeProvider: 'gemini',
    extractionMethod: 'pdfTextLayer',
    apiKey: '',
    textModel: '',
    imageModel: '',
    externalProviderName: 'ChatGPT',
    externalApiKey: '',
    externalModel: 'gpt-4o'
  });
  
  const [showKey, setShowKey] = useState(false);
  const [showExternalKey, setShowExternalKey] = useState(false);

  useEffect(() => {
    setSettings(getStoredSettings());
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleProviderChange = (provider: 'gemini' | 'external') => {
    setSettings(prev => ({ ...prev, activeProvider: provider }));
  };

  const handleExtractionMethodChange = (method: ExtractionMethod) => {
    setSettings(prev => ({ ...prev, extractionMethod: method }));
  };

  const handleSave = () => {
    saveSettings(settings);
    alert("설정이 저장되었습니다. 다음 요청부터 적용됩니다.");
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-700">
        
        {/* Header - White Text on Dark */}
        <div className="p-5 border-b border-slate-700 flex justify-between items-center bg-slate-900">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-primary-500">⚙️</span>
            AI Configuration
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
          
          {/* 원문 추출 방식 */}
          <div className="p-4 bg-slate-800 rounded-lg border border-slate-700">
            <h3 className="text-sm font-bold text-slate-200 mb-3 uppercase tracking-wider">원문 추출 방식</h3>
            <p className="text-xs text-slate-400 mb-3">PDF에서 원문을 얻는 방법을 선택하세요. 텍스트 레이어가 없는 스캔 PDF는 AI 이미지 분석을 사용하세요.</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-slate-700/50 transition-colors">
                <input
                  type="radio"
                  name="extractionMethod"
                  checked={settings.extractionMethod === 'pdfTextLayer'}
                  onChange={() => handleExtractionMethodChange('pdfTextLayer')}
                  className="mt-1 text-primary-500 focus:ring-primary-500"
                />
                <div>
                  <span className="text-sm font-medium text-white">PDF 텍스트 레이어 (기본)</span>
                  <p className="text-xs text-slate-400 mt-0.5">파일 내장 텍스트를 페이지별로 추출. 추출 시 페이지 표시(--- Page N ---)로 확인 가능.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-slate-700/50 transition-colors">
                <input
                  type="radio"
                  name="extractionMethod"
                  checked={settings.extractionMethod === 'aiVision'}
                  onChange={() => handleExtractionMethodChange('aiVision')}
                  className="mt-1 text-primary-500 focus:ring-primary-500"
                />
                <div>
                  <span className="text-sm font-medium text-white">AI 이미지 분석</span>
                  <p className="text-xs text-slate-400 mt-0.5">페이지를 이미지로 변환 후 AI가 읽어 추출. 스캔 PDF나 텍스트 레이어가 없을 때 사용.</p>
                </div>
              </label>
            </div>
          </div>

          {/* Provider Toggle */}
          <div className="flex bg-slate-800 p-1 rounded-lg">
             <button 
               onClick={() => handleProviderChange('gemini')}
               className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${settings.activeProvider === 'gemini' ? 'bg-primary-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
             >
               Google Gemini (AI Studio)
             </button>
             <button 
               onClick={() => handleProviderChange('external')}
               className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${settings.activeProvider === 'external' ? 'bg-green-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
             >
               External API (ChatGPT etc.)
             </button>
          </div>

          {settings.activeProvider === 'gemini' ? (
            <div className="space-y-5 animate-in slide-in-from-left-2">
              <div className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                <h3 className="text-sm font-bold text-primary-400 mb-4 uppercase tracking-wider">Gemini Settings</h3>
                
                {/* Text Model */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-300 mb-1">AI Text Model</label>
                    <select
                    name="textModel"
                    value={settings.textModel}
                    onChange={handleChange}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    >
                        <option value="gemini-3-pro-preview">High Intelligence (Pro) - Deep Analysis</option>
                        <option value="gemini-3-flash-preview">High Speed (Flash) - Fast & Cheap</option>
                    </select>
                </div>

                {/* Image Model */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-300 mb-1">AI Image Model</label>
                    <select
                    name="imageModel"
                    value={settings.imageModel}
                    onChange={handleChange}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    >
                        <option value="gemini-2.5-flash-image">Nano Banana (Fast & Efficient)</option>
                        <option value="gemini-3-pro-image-preview">Pro Image (High Quality Infographics)</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      'Nano Banana' is optimized for fast diagram understanding. Use Pro for high-res creation.
                    </p>
                </div>

                {/* API Key */}
                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Custom API Key (Optional)</label>
                    <div className="relative">
                    <input
                        type={showKey ? "text" : "password"}
                        name="apiKey"
                        value={settings.apiKey}
                        onChange={handleChange}
                        placeholder="Enter your Gemini API Key"
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 outline-none pr-10"
                    />
                    <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                        {showKey ? 'Hide' : 'Show'}
                    </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                    Leave empty to use the shared key. Recommended to use your own paid key for Pro models.
                    </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5 animate-in slide-in-from-right-2">
                <div className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                    <h3 className="text-sm font-bold text-green-400 mb-4 uppercase tracking-wider">External API Settings</h3>
                    
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-300 mb-1">Provider Name</label>
                        <input
                            type="text"
                            name="externalProviderName"
                            value={settings.externalProviderName}
                            onChange={handleChange}
                            placeholder="e.g. ChatGPT, Claude"
                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-green-500 outline-none"
                        />
                    </div>
                    
                    <div className="mb-4">
                         <label className="block text-sm font-medium text-slate-300 mb-1">Model Name</label>
                         <input
                            type="text"
                            name="externalModel"
                            value={settings.externalModel}
                            onChange={handleChange}
                            placeholder="e.g. gpt-4o, claude-3-opus"
                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-green-500 outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">API Key</label>
                        <div className="relative">
                        <input
                            type={showExternalKey ? "text" : "password"}
                            name="externalApiKey"
                            value={settings.externalApiKey}
                            onChange={handleChange}
                            placeholder="sk-..."
                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-green-500 outline-none pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowExternalKey(!showExternalKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                            {showExternalKey ? 'Hide' : 'Show'}
                        </button>
                        </div>
                    </div>
                </div>
            </div>
          )}
        </div>

        <div className="bg-slate-800 p-4 flex justify-end gap-3 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors hover:bg-slate-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-bold text-slate-900 bg-white rounded-lg hover:bg-gray-200 shadow-sm transition-colors"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
