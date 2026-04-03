import { create } from 'zustand';
import { savePageAnnotation, getDocumentAnnotations } from '../api/client';

// Use any for now - Excalidraw types are complex
type ExcalidrawElement = any;
interface PageMetric {
  width: number;
  height: number;
  sceneX?: number;
  sceneY?: number;
  sceneWidth?: number;
  sceneHeight?: number;
}

interface PageAnnotations {
  [pageNumber: number]: readonly ExcalidrawElement[];
}

interface PageMetrics {
  [pageNumber: number]: PageMetric | undefined;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface AnnotationState {
  annotations: PageAnnotations;
  pageMetrics: PageMetrics;
  currentPage: number;
  isDirty: boolean;
  documentId: string | null;
  saveStatus: SaveStatus;

  // Actions
  setAnnotations: (pageNumber: number, elements: readonly ExcalidrawElement[]) => void;
  getAnnotations: (pageNumber: number) => readonly ExcalidrawElement[];
  setPageMetric: (pageNumber: number, metric: Partial<PageMetric>) => void;
  getPageMetric: (pageNumber: number) => PageMetric | undefined;
  setCurrentPage: (pageNumber: number) => void;
  clearPage: (pageNumber: number) => void;
  clearAll: () => void;
  markClean: () => void;
  setDocumentId: (id: string | null) => void;
  loadAnnotationsFromServer: (documentId: string) => Promise<void>;
  flushAllPendingSaves: () => Promise<void>;
}

// Pending annotations stored outside Zustand to avoid triggering re-renders
// when called from Excalidraw's onChange handler.
let _pending: { pageNumber: number; elements: readonly ExcalidrawElement[] } | null = null;

// Per-page auto-save debounce timers
const _saveTimers = new Map<number, ReturnType<typeof setTimeout>>();

// Track in-flight saves to prevent overlapping requests per page
const _savingPages = new Set<number>();

// Retry counters for exponential backoff
const _retryCounters = new Map<number, number>();

function scheduleSave(pageNumber: number) {
  const existing = _saveTimers.get(pageNumber);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    _saveTimers.delete(pageNumber);
    const state = useAnnotationStore.getState();
    const { documentId } = state;
    if (!documentId) return;

    const elements = state.annotations[pageNumber];
    if (!elements) return;

    if (_savingPages.has(pageNumber)) return;
    _savingPages.add(pageNumber);

    useAnnotationStore.setState({ saveStatus: 'saving' });
    try {
      const pageMetrics = state.pageMetrics[pageNumber] || null;
      await savePageAnnotation(
        documentId,
        pageNumber,
        elements as unknown[],
        pageMetrics as Record<string, unknown> | null,
      );
      _retryCounters.delete(pageNumber);
      useAnnotationStore.setState({ saveStatus: 'saved' });
    } catch (err) {
      console.error('Auto-save failed for page', pageNumber, err);
      useAnnotationStore.setState({ saveStatus: 'error' });
      // Retry with exponential backoff (1s, 2s, 4s, max 30s)
      const retryCount = (_retryCounters.get(pageNumber) || 0) + 1;
      _retryCounters.set(pageNumber, retryCount);
      const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000);
      _saveTimers.set(pageNumber, setTimeout(() => {
        _saveTimers.delete(pageNumber);
        scheduleSave(pageNumber);
      }, delay));
    } finally {
      _savingPages.delete(pageNumber);
    }
  }, 5000);

  _saveTimers.set(pageNumber, timer);
}

function cancelAllTimers() {
  for (const timer of _saveTimers.values()) {
    clearTimeout(timer);
  }
  _saveTimers.clear();
  _retryCounters.clear();
}

export function setPendingAnnotations(pageNumber: number, elements: readonly ExcalidrawElement[]) {
  _pending = { pageNumber, elements };
}

export function flushPendingAnnotations() {
  if (_pending) {
    const { pageNumber, elements } = _pending;
    useAnnotationStore.getState().setAnnotations(pageNumber, elements);
    _pending = null;
  }
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  annotations: {},
  pageMetrics: {},
  currentPage: 1,
  isDirty: false,
  documentId: null,
  saveStatus: 'idle',

  setAnnotations: (pageNumber, elements) => {
    set((state) => ({
      annotations: {
        ...state.annotations,
        [pageNumber]: elements
      },
      isDirty: true
    }));

    // Schedule auto-save if connected to a backend document
    if (get().documentId) {
      scheduleSave(pageNumber);
    }
  },

  getAnnotations: (pageNumber) => {
    return get().annotations[pageNumber] || [];
  },

  setPageMetric: (pageNumber, metric) => {
    set((state) => ({
      pageMetrics: {
        ...state.pageMetrics,
        [pageNumber]: {
          ...state.pageMetrics[pageNumber],
          ...metric,
        } as PageMetric,
      },
    }));
  },

  getPageMetric: (pageNumber) => {
    return get().pageMetrics[pageNumber];
  },

  setCurrentPage: (pageNumber) => {
    set({ currentPage: pageNumber });
  },

  clearPage: (pageNumber) => {
    set((state) => {
      const newAnnotations = { ...state.annotations };
      delete newAnnotations[pageNumber];
      return {
        annotations: newAnnotations,
        isDirty: true
      };
    });
  },

  clearAll: () => {
    cancelAllTimers();
    set({
      annotations: {},
      pageMetrics: {},
      isDirty: true,
      documentId: null,
      saveStatus: 'idle',
    });
  },

  markClean: () => {
    set({ isDirty: false });
  },

  setDocumentId: (id) => {
    if (!id) cancelAllTimers();
    set({ documentId: id, saveStatus: 'idle' });
  },

  loadAnnotationsFromServer: async (documentId) => {
    try {
      const records = await getDocumentAnnotations(documentId);
      const annotations: PageAnnotations = {};
      const pageMetrics: PageMetrics = {};

      for (const record of records) {
        annotations[record.page_number] = record.elements as readonly ExcalidrawElement[];
        if (record.pageMetrics) {
          pageMetrics[record.page_number] = record.pageMetrics as unknown as PageMetric;
        }
      }

      set({
        annotations,
        pageMetrics: { ...get().pageMetrics, ...pageMetrics },
        documentId,
        isDirty: false,
        saveStatus: 'idle',
      });
    } catch (err) {
      console.error('Failed to load annotations:', err);
    }
  },

  flushAllPendingSaves: async () => {
    // Flush any pending Excalidraw changes first
    flushPendingAnnotations();

    // Collect pages with pending timers
    const pagesToSave: number[] = [];
    for (const [pageNumber, timer] of _saveTimers.entries()) {
      clearTimeout(timer);
      pagesToSave.push(pageNumber);
    }
    _saveTimers.clear();

    const state = get();
    const { documentId } = state;
    if (!documentId || pagesToSave.length === 0) return;

    set({ saveStatus: 'saving' });
    try {
      await Promise.all(
        pagesToSave.map((pageNumber) => {
          const elements = state.annotations[pageNumber];
          if (!elements) return Promise.resolve();
          const pageMetricsData = state.pageMetrics[pageNumber] || null;
          return savePageAnnotation(
            documentId,
            pageNumber,
            elements as unknown[],
            pageMetricsData as Record<string, unknown> | null,
          );
        })
      );
      set({ saveStatus: 'saved' });
    } catch (err) {
      console.error('Flush saves failed:', err);
      set({ saveStatus: 'error' });
    }
  },
}));
