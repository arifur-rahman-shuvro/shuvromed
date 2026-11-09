import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../App'
import { AuthProvider, type AuthClient } from '../auth/AuthContext'
import { ContentClientContext } from '../data/ContentContext'
import { createContentClient, type ContentClient } from '../data/loader'
import { makeFakeAuth, type FakeAuth } from './fakeAuthClient'
import { bundleFetcher, realBundle } from './content'

/** A content client that serves the REAL built bundle through the real loader, with no network. */
export function realContentClient(): ContentClient {
  return createContentClient(bundleFetcher(realBundle()))
}

export const TEST_USER_ID = 'id-me@test.local'

export function renderApp(
  path: string,
  fake: FakeAuth = makeFakeAuth({ signedInAs: 'me@test.local' }),
  client: AuthClient | null = fake.client,
  content: ContentClient = realContentClient(),
) {
  // Since the cutover the workspace is on by default. Tests of the old screens keep the old menu unless they chose otherwise.
  if (localStorage.getItem(`shuvromed.workspace.enabled.v1.${TEST_USER_ID}`) === null) localStorage.setItem(`shuvromed.workspace.enabled.v1.${TEST_USER_ID}`, '0')
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const utils = render(
    <ContentClientContext.Provider value={content}>
      <AuthProvider client={client}>
        <RouterProvider router={router} />
      </AuthProvider>
    </ContentClientContext.Provider>,
  )
  return { ...utils, fake, router }
}
