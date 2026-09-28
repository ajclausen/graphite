import { useState, useEffect, useCallback } from 'react';
import './utils/pdfWorker';
import './App.css';
import { DocumentLibrary } from './components/DocumentLibrary';
import { IntegratedPDFAnnotator } from './components/IntegratedPDFAnnotator';
import { LoginPage } from './components/LoginPage';
import { ChangePasswordPage } from './components/ChangePasswordPage';
import { AdminPage } from './components/AdminPage';
import { AppHeader } from './components/AppHeader';
import { GlobalOverlays } from './components/ui/Overlays';
import { useAnnotationStore } from './store/annotationStore';
import { useAuthStore } from './store/authStore';
import { toast } from './store/uiStore';
import { getDocument, type Document } from './api/client';
import { navigate, useRoute } from './utils/router';

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <div className="g-spinner" />
      <span className="app-loading-label">{label}</span>
    </div>
  );
}

function AppContent() {
  const route = useRoute();
  const [activeDocument, setActiveDocument] = useState<Document | null>(null);

  const {
    user,
    isAuthenticated,
    isLoading,
    checkAuth,
    logout,
  } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const routeDocId = route.name === 'document' ? route.id : null;

  // Resolve the document for #/d/<id> (deep link, refresh, or back/forward).
  useEffect(() => {
    if (!isAuthenticated || !routeDocId) {
      if (!routeDocId) setActiveDocument(null);
      return;
    }
    if (activeDocument?.id === routeDocId) return;

    let cancelled = false;
    getDocument(routeDocId)
      .then((doc) => {
        if (!cancelled) setActiveDocument(doc);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('That document couldn’t be opened', 'It may have been deleted or you may not have access.');
        navigate({ name: 'library' }, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, routeDocId, activeDocument?.id]);

  // Non-admins who land on #/admin get bounced to the library.
  useEffect(() => {
    if (route.name === 'admin' && user && user.role !== 'admin') {
      navigate({ name: 'library' }, { replace: true });
    }
  }, [route.name, user]);

  useEffect(() => {
    const base = 'Graphite';
    if (route.name === 'document' && activeDocument) {
      document.title = `${activeDocument.original_name} · ${base}`;
    } else if (route.name === 'admin') {
      document.title = `Users · ${base}`;
    } else {
      document.title = base;
    }
  }, [route.name, activeDocument]);

  const handleDocumentSelect = useCallback((doc: Document) => {
    setActiveDocument(doc);
    navigate({ name: 'document', id: doc.id });
  }, []);

  const handleDocumentChange = useCallback((doc: Document) => {
    setActiveDocument(doc);
    navigate({ name: 'document', id: doc.id });
  }, []);

  const handlePageChange = useCallback((docId: string, page: number) => {
    navigate({ name: 'document', id: docId, page }, { replace: true });
  }, []);

  const handleBackToLibrary = useCallback(async () => {
    await useAnnotationStore.getState().flushAllPendingSaves();
    navigate({ name: 'library' });
  }, []);

  const handleLogout = useCallback(async () => {
    await useAnnotationStore.getState().flushAllPendingSaves();
    useAnnotationStore.getState().clearAll();
    setActiveDocument(null);
    await logout();
    navigate({ name: 'library' }, { replace: true });
  }, [logout]);

  if (isLoading) {
    return (
      <div className="app">
        <FullPageSpinner label="Loading…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Mandatory password/account setup (first login with default credentials)
  if (user?.mustChangePassword) {
    return <ChangePasswordPage />;
  }

  if (route.name === 'document') {
    if (!activeDocument || activeDocument.id !== route.id) {
      return (
        <div className="app">
          <FullPageSpinner label="Opening document…" />
        </div>
      );
    }
    return (
      <IntegratedPDFAnnotator
        document={activeDocument}
        initialPage={route.page}
        onBack={handleBackToLibrary}
        onDocumentChange={handleDocumentChange}
        onPageChange={handlePageChange}
      />
    );
  }

  const isAdminView = route.name === 'admin' && user?.role === 'admin';

  return (
    <div className="app">
      <AppHeader user={user} current={isAdminView ? 'admin' : 'library'} onLogout={handleLogout} />
      <main className="app-main">
        {isAdminView ? (
          <AdminPage />
        ) : (
          <DocumentLibrary onDocumentSelect={handleDocumentSelect} />
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <>
      <AppContent />
      <GlobalOverlays />
    </>
  );
}

export default App;
