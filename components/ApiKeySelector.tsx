
import React, { useState, useEffect, useCallback } from 'react';

interface ApiKeySelectorProps {
  children: React.ReactNode;
  onKeySelectionChange: (isSelected: boolean) => void;
}

export const ApiKeySelector: React.FC<ApiKeySelectorProps> = ({ children, onKeySelectionChange }) => {
  const [isKeySelected, setIsKeySelected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  const checkApiKey = useCallback(async () => {
    try {
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setIsKeySelected(hasKey);
        onKeySelectionChange(hasKey);
      } else {
        setIsKeySelected(false);
        onKeySelectionChange(false);
      }
    } catch (error) {
      console.error("Error checking for API key:", error);
      setIsKeySelected(false);
      onKeySelectionChange(false);
    } finally {
        setIsChecking(false);
    }
  }, [onKeySelectionChange]);

  useEffect(() => {
    checkApiKey();
  }, [checkApiKey]);

  // FIX: As per guidelines, assume key selection is successful after opening the dialog
  // to mitigate potential race conditions with hasSelectedApiKey.
  const handleSelectKey = async () => {
    try {
      if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
        await window.aistudio.openSelectKey();
        setIsKeySelected(true);
        onKeySelectionChange(true);
      }
    } catch (error) {
      console.error("Error opening API key selection:", error);
    }
  };

  if (isChecking) {
      return (
          <div className="flex flex-col items-center justify-center p-8 border border-gray-700 rounded-lg bg-gray-800 text-white">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mb-4"></div>
              <p>Verifying API key status...</p>
          </div>
      )
  }

  if (!isKeySelected) {
    return (
      <div className="flex flex-col items-center justify-center p-8 border border-gray-700 rounded-lg bg-gray-800 text-white">
        <h3 className="text-xl font-bold mb-4 text-center">API Key Required for Video Generation</h3>
        <p className="text-gray-300 mb-6 text-center">
          To use Veo video generation, you need to select an API key. This will enable billing for your project.
        </p>
        <button
          onClick={handleSelectKey}
          className="bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-2 px-6 rounded-lg transition-colors duration-300"
        >
          Select API Key
        </button>
        <a 
            href="https://ai.google.dev/gemini-api/docs/billing" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-sm text-blue-400 hover:underline mt-4">
            Learn more about billing
        </a>
      </div>
    );
  }

  return <>{children}</>;
};
