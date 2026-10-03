import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import '@testing-library/jest-dom/vitest'

// happy-dom >= 20 passes the form's own Proxy as `submitter` when
// requestSubmit() is called with no argument; the spec default is null.
// React's form-action listener then throws inside `new FormData(form,
// submitter)` and the action never runs. Re-implement with the spec
// submitter (this codebase only ever calls it bare).
HTMLFormElement.prototype.requestSubmit = function (this: HTMLFormElement) {
  if (this.checkValidity()) {
    this.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
  }
}

// Unmount React trees after each test to prevent memory leaks and
// cross-test state bleed.
afterEach(() => {
  cleanup()
})
