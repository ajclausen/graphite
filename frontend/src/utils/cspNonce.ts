declare let __webpack_nonce__: string | undefined;

declare global {
  interface Window {
    __webpack_nonce__?: string;
  }
}

const nonce = document
  .querySelector('meta[name="csp-nonce"]')
  ?.getAttribute('content');

if (nonce && !nonce.startsWith('__')) {
  __webpack_nonce__ = nonce;
  window.__webpack_nonce__ = nonce;
}

export {};
