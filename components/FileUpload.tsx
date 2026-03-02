import React, { useCallback, useState } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, isProcessing }) => {
  const [isDragging, setIsDragging] = useState(false);
  const isAllowedFile = (file: File) => {
    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
    const isStp = lowerName.endsWith('.stp');
    return isPdf || isStp;
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing && !isDragging) {
         setIsDragging(true);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isProcessing) return;
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (isAllowedFile(file)) {
        onFileSelect(file);
      } else {
        alert("Please upload a PDF or STP file.");
      }
    }
  }, [onFileSelect, isProcessing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!isAllowedFile(file)) {
        alert("Please upload a PDF or STP file.");
        e.target.value = '';
        return;
      }
      onFileSelect(file);
    }
  };

  const handleContainerClick = () => {
    if (!isProcessing) {
        document.getElementById('file-upload')?.click();
    }
  };

  return (
    <div 
      className={`border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200 ease-in-out ${
        isProcessing 
          ? 'border-gray-300 bg-gray-50 opacity-50 cursor-not-allowed' 
          : isDragging
            ? 'border-primary-600 bg-primary-100 scale-[1.02] shadow-lg'
            : 'border-primary-300 bg-primary-50 hover:bg-primary-100 hover:border-primary-400 cursor-pointer'
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleContainerClick}
    >
      {/* Pointer events none on children prevents drag flickering and allows click through to parent */}
      <div className="flex flex-col items-center gap-4 pointer-events-none">
        <div className={`p-4 rounded-full transition-colors ${isDragging ? 'bg-primary-200' : 'bg-white'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-12 h-12 ${isDragging ? 'text-primary-700' : 'text-primary-500'}`}>
             <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
        </div>
        
        <div>
          <h3 className="text-xl font-bold text-gray-900 mb-1">
             {isDragging ? 'Drop PDF/STP here' : 'Upload Research Paper or STP Project'}
          </h3>
          <p className="text-gray-500 text-sm">
            Drag & drop your PDF/STP here, or click to browse
          </p>
        </div>

        {/* This span looks like a button but is just visual since the parent click handles it */}
        <span 
          className={`px-6 py-2 rounded-lg font-medium text-white shadow-sm transition-all mt-2 ${
            isProcessing ? 'bg-gray-400' : 'bg-primary-600'
          }`}
        >
          {isProcessing ? 'Processing...' : 'Select PDF/STP'}
        </span>
      </div>

      <input
        type="file"
        accept=".pdf,.stp,application/pdf"
        className="hidden"
        id="file-upload"
        onChange={handleChange}
        disabled={isProcessing}
        onClick={(e) => e.stopPropagation()} 
      />
    </div>
  );
};

export default FileUpload;