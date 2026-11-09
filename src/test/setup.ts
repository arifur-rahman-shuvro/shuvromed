import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// The whole suite runs in parallel on a busy machine; the default 1 s wait for screens to appear is too tight and made tests flaky.
configure({ asyncUtilTimeout: 4000 })
