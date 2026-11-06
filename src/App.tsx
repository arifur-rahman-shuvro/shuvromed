import { lazy, Suspense } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { Skeleton } from './components/ui'
import Landing from './pages/Landing'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const ComingSoon = lazy(() => import('./pages/ComingSoon'))
const AuthPlaceholder = lazy(() => import('./pages/AuthPlaceholder'))

const fallback = (
  <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading">
    <Skeleton className="h-8 w-1/3" />
    <Skeleton className="h-24 w-full" />
  </div>
)

const wrap = (el: React.ReactNode) => <Suspense fallback={fallback}>{el}</Suspense>

export const routes = [
  { path: '/', element: <Landing /> },
  { path: '/login', element: wrap(<AuthPlaceholder mode="login" />) },
  { path: '/signup', element: wrap(<AuthPlaceholder mode="signup" />) },
  {
    path: '/app',
    element: <AppLayout />,
    children: [
      { index: true, element: wrap(<Dashboard />) },
      { path: 'subjects', element: wrap(<ComingSoon title="Subjects" phase="Phase 3" />) },
      { path: 'revision', element: wrap(<ComingSoon title="Revision" phase="Phase 4" />) },
      { path: 'mock', element: wrap(<ComingSoon title="Mock exam" phase="Phase 5" />) },
      { path: 'analytics', element: wrap(<ComingSoon title="Analytics" phase="Phase 6" />) },
      { path: 'settings', element: wrap(<ComingSoon title="Settings" phase="Phase 2 and 7" />) },
    ],
  },
  { path: '*', element: wrap(<ComingSoon title="Page not found" phase="never" />) },
]

export default function App() {
  return <RouterProvider router={createBrowserRouter(routes)} />
}
