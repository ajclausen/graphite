import React, { useState } from 'react';
import { Icon } from './Icon';

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** Password field with a show/hide toggle (helps on phones and for low vision). */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className = '', ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <div className="g-input-wrap">
        <input
          ref={ref}
          {...props}
          type={visible ? 'text' : 'password'}
          className={`g-input ${className}`}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="g-icon-btn g-input-action"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          disabled={props.disabled}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={17} />
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
