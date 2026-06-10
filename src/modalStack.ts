// Explicit modal layering stack.
//
// Each open modal registers an opaque token on mount and removes it on unmount.
// "Topmost" is simply the most recently pushed token still present. This lets
// Escape, the Tab focus trap, and backdrop clicks act on the top layer only,
// without coupling to DOM order or CSS class names. Tokens are object
// identities, so callers never need to mint unique ids.

const stack: object[] = [];

export function pushModal(token: object): void {
  stack.push(token);
}

export function popModal(token: object): void {
  const index = stack.lastIndexOf(token);
  if (index !== -1) {
    stack.splice(index, 1);
  }
}

export function isTopmostModal(token: object): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token;
}
