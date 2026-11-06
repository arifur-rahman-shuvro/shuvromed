import { lazy, Suspense, useMemo } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { Skeleton } from './components/ui'
import { AuthProvider } from './auth/AuthContext'
import RequireAuth from './auth/RequireAuth'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './auth/pages'
import { supabase } from './lib/supabase'
import Landing from './pages/Landing'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const ComingSoon = lazy(() => import('./pages/ComingSoon'))
const ContentRoute = lazy(() => import('./data/ContentContext').then((m) => ({ default: m.ContentRoute })))
const Subjects = lazy(() => import('./pages/Subjects'))
const SubjectTopics = lazy(() => import('./pages/SubjectTopics'))
const PracticeSetup = lazy(() => import('./pages/PracticeSetup'))
const PracticePlayer = lazy(() => import('./pages/PracticePlayer'))

const fallback = (
  <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading">
    <Skeleton className="h-8 w-1/3" />
    <Skeleton className="h-24 w-full" />
  </div>
)

const wrap = (el: React.ReactNode) => <Suspense fallback={fallback}>{el}</Suspense>

export const routes = [
  { path: '/', element: <Landing /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/app',
        element: <AppLayout />,
        children: [
          { index: true, element: wrap(<Dashboard />) },
          {
            element: wrap(<ContentRoute />),
            children: [
              { path: 'subjects', element: wrap(<Subjects />) },
              { path: 'subjects/:subjectId', element: wrap(<SubjectTopics />) },
              { path: 'practice', element: wrap(<PracticeSetup />) },
              { path: 'practice/play', element: wrap(<PracticePlayer />) },
            ],
          },
          { path: 'revision', element: wrap(<ComingSoon title="Revision" phase="Phase 4" />) },
          { path: 'mock', element: wrap(<ComingSoon title="Mock exam" phase="Phase 5" />) },
          { path: 'analytics', element: wrap(<ComingSoon title="Analytics" phase="Phase 6" />) },
          { path: 'settings', element: wrap(<ComingSoon title="Settings" phase="Phase 7" />) },
        ],
      },
    ],
  },
  { path: '*', element: wrap(<ComingSoon title="Page not found" phase="never" />) },
]

export default function App() {
  const router = useMemo(() => createBrowserRouter(routes), [])
  return (
    <AuthProvider client={supabase?.auth ?? null}>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
