import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import '@testing-library/jest-dom/vitest'

// happy-dom >= 20 passes the form's own Proxy as `submitter` on a bare
// requestSubmit(); the spec default is null — React's form-action
// listener throws inside `new FormData(form, submitter)` and the action
// never runs. Re-implement per spec (this codebase only calls it bare).
// Guarded: node-env test files have no DOM globals.
if (typeof HTMLFormElement !== 'undefined') {
  HTMLFormElement.prototype.requestSubmit = function (this: HTMLFormElement) {
    if (this.checkValidity()) {
      this.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    }
  }
}

// Unmount React trees after each test to prevent memory leaks and
// cross-test state bleed.
afterEach(() => {
  cleanup()
})
