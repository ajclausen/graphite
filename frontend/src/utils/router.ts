import { useEffect, useState } from 'react';

/**
 * Minimal hash router. Hash routes keep the server config untouched (no SPA
 * fallback needed) while giving us working refresh, back/forward and links.
 *
 *   #/            → library
 *   #/d/<id>      → annotator for a document
 *   #/d/<id>/<n>  → annotator, opened at page n
 *   #/admin       → user management
 */
export type Route =
  | { name: 'library' }
  | { name: 'document'; id: string; page?: number }
  | { name: 'admin' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const docMatch = path.match(/^\/d\/([^/?#]+)(?:\/(\d+))?/);
  if (docMatch) {
    const page = docMatch[2] ? parseInt(docMatch[2], 10) : undefined;
    return { name: 'document', id: decodeURIComponent(docMatch[1]), page: page && page > 1 ? page : undefined };
  }
  if (path.startsWith('/admin')) return { name: 'admin' };
  return { name: 'library' };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'document':
      return `#/d/${encodeURIComponent(route.id)}${route.page && route.page > 1 ? `/${route.page}` : ''}`;
    case 'admin':
      return '#/admin';
    default:
      return '#/';
  }
}

export function navigate(route: Route, options: { replace?: boolean } = {}) {
  const hash = routeToHash(route);
  if (window.location.hash === hash) return;
  if (options.replace) {
    window.history.replaceState(null, '', hash);
    // replaceState doesn't fire hashchange; notify listeners manually.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const handleChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', handleChange);
    return () => window.removeEventListener('hashchange', handleChange);
  }, []);

  return route;
}
