import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listDocuments, type Document } from '../api/client';
import { parseTimestamp, pluralize } from '../utils/format';
import { PHONE_QUERY, useMediaQuery } from '../utils/useMediaQuery';
import { Icon } from './ui/Icon';

interface DocSwitcherProps {
  current: Document;
  /** Extra documents known locally (e.g. just extracted) before the list refreshes. */
  knownDocuments?: Document[];
  onSelect: (doc: Document) => void;
}

/**
 * Document title button that opens a searchable list of documents
 * (ARIA combobox + listbox: type to filter, arrows to move, Enter to open).
 */
export const DocSwitcher: React.FC<DocSwitcherProps> = ({ current, knownDocuments = [], onSelect }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<Document[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const isSheet = useMediaQuery(PHONE_QUERY);
  const id = useId();
  const listId = `${id}-list`;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    listDocuments()
      .then((list) => { setDocs(list); setLoaded(true); })
      .catch(() => setLoaded(true));
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(() => {
    const byId = new Map<string, Document>();
    for (const d of [...knownDocuments, ...docs]) byId.set(d.id, d);
    const all = [...byId.values()].sort((a, b) => (
      parseTimestamp(b.last_edited_at ?? b.updated_at).getTime() -
      parseTimestamp(a.last_edited_at ?? a.updated_at).getTime()
    ));
    const needle = query.trim().toLocaleLowerCase();
    return needle ? all.filter((d) => d.original_name.toLocaleLowerCase().includes(needle)) : all;
  }, [docs, knownDocuments, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || listRef.current?.closest('.doc-switcher-panel')?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (doc: Document) => {
    setOpen(false);
    if (doc.id !== current.id) onSelect(doc);
    else triggerRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (results[activeIndex]) choose(results[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const activeId = results[activeIndex] ? `${id}-opt-${results[activeIndex].id}` : undefined;

  const panel = (
    <div className={`doc-switcher-panel${isSheet ? ' is-sheet' : ''}`} role="dialog" aria-label="Switch document">
      <div className="g-input-wrap g-input-wrap--leading doc-switcher-search">
        <Icon name="search" size={16} className="g-input-icon" />
        <input
          ref={inputRef}
          className="g-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Search documents"
          placeholder="Jump to document…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
      </div>
      <div className="doc-switcher-heading" aria-hidden="true">{query ? 'Matches' : 'Recent'}</div>
      <ul ref={listRef} id={listId} role="listbox" aria-label="Documents" className="doc-switcher-list">
        {results.map((d, index) => (
          <li
            key={d.id}
            id={`${id}-opt-${d.id}`}
            role="option"
            aria-selected={index === activeIndex}
            aria-current={d.id === current.id ? 'true' : undefined}
            className={`doc-switcher-option${index === activeIndex ? ' is-active' : ''}${d.id === current.id ? ' is-current' : ''}`}
            onPointerMove={() => setActiveIndex(index)}
            onClick={() => choose(d)}
          >
            <Icon name={d.file_type === 'image' ? 'image' : 'file'} size={16} strokeWidth={1.8} />
            <span className="doc-switcher-option-name">{d.original_name}</span>
            <span className="doc-switcher-option-meta">
              {d.id === current.id ? 'Open' : d.file_type === 'image' ? 'Image' : d.page_count != null ? pluralize(d.page_count, 'page') : ''}
            </span>
          </li>
        ))}
      </ul>
      {results.length === 0 && (
        <div className="doc-switcher-empty" role="status">
          {loaded ? 'No matching documents' : 'Loading…'}
        </div>
      )}
    </div>
  );

  return (
    <div className="doc-switcher" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`doc-switcher-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={current.original_name}
      >
        <span className="doc-switcher-name">{current.original_name}</span>
        <Icon name="chevronDown" size={14} className="doc-switcher-chevron" />
        <span className="visually-hidden">, switch document</span>
      </button>
      {open && (isSheet
        ? createPortal(
          <>
            <div className="g-sheet-backdrop" onClick={close} />
            {panel}
          </>,
          document.body,
        )
        : panel)}
    </div>
  );
};
