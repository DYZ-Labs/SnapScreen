export class SessionDisposalGuard {
  private active = false;

  begin(): void {
    this.active = true;
  }

  dispose(callback: () => void): boolean {
    if (!this.active) return false;
    this.active = false;
    callback();
    return true;
  }
}
