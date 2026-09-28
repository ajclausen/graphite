import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { PHONE_QUERY, useMediaQuery } from '../../utils/useMediaQuery';
import './ui.css';

export interface MenuItemDef {
  id: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  hint?: string;
}

export interface MenuTriggerProps {
  ref: React.Ref<HTMLButtonElement>;
  id: string;
  onClick: (event: React.MouseEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

interface MenuProps {
  items: MenuItemDef[];
  /** Optional heading shown above the items (always shown in the phone sheet). */
  header?: { title: string; subtitle?: string };
  align?: 'start' | 'end';
  renderTrigger: (props: MenuTriggerProps, open: boolean) => React.ReactElement;
}

type FocusTarget = 'first' | 'last';

/**
 * Accessible menu button (WAI-ARIA menu pattern): arrow keys, Home/End and
 * type-ahead move focus; Escape or Tab closes and returns focus to the
 * trigger. Renders in a portal so it's never clipped by scrolling containers,
 * and as a bottom sheet on phones.
 */
export const Menu: React.FC<MenuProps> = ({ items, header, align = 'end', renderTrigger }) => {
  const [open, setOpen] = useState(false);
  const [initialFocus, setInitialFocus] = useState<FocusTarget>('first');
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isSheet = useMediaQuery(PHONE_QUERY);
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const menuId = `${baseId}-menu`;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback((focus: FocusTarget) => {
    setInitialFocus(focus);
    setPosition({ visibility: 'hidden' });
    setOpen(true);
  }, []);

  // Place the popover next to its trigger, flipping above when there's no room.
  useLayoutEffect(() => {
    if (!open || isSheet) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const top = spaceBelow >= menuRect.height + gap || rect.top < menuRect.height + gap
      ? rect.bottom + gap
      : rect.top - gap - menuRect.height;
    let left = align === 'end' ? rect.right - menuRect.width : rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));
    setPosition({ top: Math.max(margin, top), left });
  }, [open, isSheet, align]);

  // Move focus into the menu once it's visible.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const enabled = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
      if (!enabled || enabled.length === 0) return;
      (initialFocus === 'last' ? enabled[enabled.length - 1] : enabled[0]).focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, initialFocus, position]);

  // Dismiss on outside press, resize, or when the page scrolls under a popover.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const handleScroll = (event: Event) => {
      if (isSheet || menuRef.current?.contains(event.target as Node)) return;
      close(false);
    };
    const handleResize = () => close(false);
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [open, isSheet, close]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      openMenu('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      openMenu('last');
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    const enabled = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => enabled[(i + enabled.length) % enabled.length]?.focus();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(enabled.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        event.preventDefault();
        close();
        break;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const char = event.key.toLowerCase();
          const ordered = [...enabled.slice(index + 1), ...enabled.slice(0, index + 1)];
          ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(char))?.focus();
        }
    }
    event.stopPropagation();
  };

  const choose = (item: MenuItemDef) => {
    close();
    item.onSelect();
  };

  const triggerProps: MenuTriggerProps = {
    ref: triggerRef,
    id: triggerId,
    onClick: (event) => {
      event.stopPropagation();
      if (open) {
        close(false);
      } else {
        openMenu('first');
      }
    },
    onKeyDown: handleTriggerKeyDown,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
  };

  return (
    <>
      {renderTrigger(triggerProps, open)}
      {open && createPortal(
        <>
          {isSheet && <div className="g-sheet-backdrop" onClick={() => close()} />}
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-labelledby={header ? `${menuId}-title` : triggerId}
            className={`g-menu${isSheet ? ' is-sheet' : ''}`}
            style={isSheet ? undefined : position}
            onKeyDown={handleMenuKeyDown}
            onClick={(e) => e.stopPropagation()}
          >
            {header && (
              <>
                <div className="g-menu-header">
                  <div className="g-menu-title" id={`${menuId}-title`}>{header.title}</div>
                  {header.subtitle && <div className="g-menu-subtitle">{header.subtitle}</div>}
                </div>
                <div className="g-menu-separator" role="separator" />
              </>
            )}
            {items.map((item) => (
              <React.Fragment key={item.id}>
                {item.separatorBefore && <div className="g-menu-separator" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={`g-menu-item${item.danger ? ' g-menu-item--danger' : ''}`}
                  disabled={item.disabled}
                  onClick={() => choose(item)}
                >
                  {item.icon && <Icon name={item.icon} size={17} />}
                  <span>{item.label}</span>
                  {item.hint && <span className="g-menu-item-hint">{item.hint}</span>}
                </button>
              </React.Fragment>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
};
