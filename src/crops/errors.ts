export class ElementNotVisibleError extends Error {
  constructor(public locator: string) {
    super(`Element not visible or zero-size: ${locator}`);
    this.name = 'ElementNotVisibleError';
  }
}
