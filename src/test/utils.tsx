import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../App'
import { AuthProvider, type AuthClient } from '../auth/AuthContext'
import { makeFakeAuth, type FakeAuth } from './fakeAuthClient'

export function renderApp(path: string, fake: FakeAuth = makeFakeAuth({ signedInAs: 'me@test.local' }), client: AuthClient | null = fake.client) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const utils = render(
    <AuthProvider client={client}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return { ...utils, fake, router }
}
