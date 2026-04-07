import { useState, useEffect } from 'react';
import './utils/pdfWorker';
import './App.css';
import { DocumentLibrary } from './components/DocumentLibrary';
import { IntegratedPDFAnnotator } from './components/IntegratedPDFAnnotator';
import { ThemeToggle } from './components/ThemeToggle';
import { LoginPage } from './components/LoginPage';
import { ChangePasswordPage } from './components/ChangePasswordPage';
import { AdminPage } from './components/AdminPage';
import { useAnnotationStore } from './store/annotationStore';
import { useAuthStore } from './store/authStore';
import type { Document } from './api/client';

type AppView = 'library' | 'annotator' | 'admin';

function App() {
  const [view, setView] = useState<AppView>('library');
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

  const handleDocumentSelect = (doc: Document) => {
    setActiveDocument(doc);
    setView('annotator');
  };

  const handleDocumentChange = (doc: Document) => {
    setActiveDocument(doc);
  };

  const handleBackToLibrary = async () => {
    await useAnnotationStore.getState().flushAllPendingSaves();
    useAnnotationStore.getState().clearAll();
    setActiveDocument(null);
    setView('library');
  };

  const handleLogout = async () => {
    await useAnnotationStore.getState().flushAllPendingSaves();
    useAnnotationStore.getState().clearAll();
    setActiveDocument(null);
    setView('library');
    await logout();
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="app">
        <div className="app-loading">
          <div className="app-loading-spinner" />
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Mandatory password/account setup (first login with default credentials)
  if (user?.mustChangePassword) {
    return <ChangePasswordPage />;
  }

  // Admin page
  if (view === 'admin') {
    return <AdminPage onBack={() => setView('library')} />;
  }

  return (
    <div className="app">
      {view === 'library' && (
        <>
          <header className="app-header">
            <div className="app-brand">
              <img className="app-brand-mark" src="/logo.png" alt="Graphite logo" />
              <div className="app-brand-text">
                <h1>Graphite</h1>
                <p className="app-tagline">annotate &middot; sketch &middot; export</p>
              </div>
            </div>
            <div className="user-menu">
              <span className="user-menu-email">{user?.email}</span>
              {user?.role === 'admin' && (
                <button
                  className="user-menu-btn"
                  onClick={() => setView('admin')}
                >
                  Admin
                </button>
              )}
              <ThemeToggle />
              <button
                className="user-menu-btn user-menu-btn--danger"
                onClick={handleLogout}
              >
                Sign out
              </button>
            </div>
          </header>
          <main className="app-main">
            <DocumentLibrary onDocumentSelect={handleDocumentSelect} />
          </main>
        </>
      )}

      {view === 'annotator' && activeDocument && (
        <IntegratedPDFAnnotator
          document={activeDocument}
          onBack={handleBackToLibrary}
          onDocumentChange={handleDocumentChange}
        />
      )}
    </div>
  );
}

export default App;
