
export enum AspectRatio {
  Portrait = '9:16',
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';

// FIX: Removed the conflicting global declaration for `window.aistudio`.
// The error indicated that this was a duplicate declaration, likely provided by another
// global type definition file in the project.
