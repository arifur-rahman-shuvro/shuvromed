import { lazy, Suspense, useMemo } from 'react'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom'
import { Skeleton } from './components/ui'
import RouteAnnouncer from './components/RouteAnnouncer'
import { AuthProvider } from './auth/AuthContext'
import RequireAuth from './auth/RequireAuth'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './auth/pages'
import PreviewBanner from './components/PreviewBanner'
import PwaPrompt from './pwa/PwaPrompt'
import { routerBasename } from './lib/appUrl'
import { supabase } from './lib/supabase'
import Landing from './pages/Landing'

const AppLayout = lazy(() => import('./components/AppLayout'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const NotFound = lazy(() => import('./pages/NotFound'))
const ContentRoute = lazy(() => import('./data/ContentContext').then((m) => ({ default: m.ContentRoute })))
const Subjects = lazy(() => import('./pages/Subjects'))
const SubjectTopics = lazy(() => import('./pages/SubjectTopics'))
const PracticeSetup = lazy(() => import('./pages/PracticeSetup'))
const PracticePlayer = lazy(() => import('./pages/PracticePlayer'))
const Revision = lazy(() => import('./pages/Revision'))
const Bookmarks = lazy(() => import('./pages/Bookmarks'))
const Notebook = lazy(() => import('./pages/Notebook'))
const WorkspaceSubjects = lazy(() => import('./pages/WorkspaceSubjects'))
const Settings = lazy(() => import('./pages/Settings'))
const Admin = lazy(() => import('./pages/Admin'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Progress = lazy(() => import('./pages/Progress'))
const MockSetup = lazy(() => import('./pages/MockSetup'))
const MockRun = lazy(() => import('./pages/MockRun'))
const MockResult = lazy(() => import('./pages/MockResult'))

const fallback = (
  <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading">
    <Skeleton className="h-8 w-1/3" />
    <Skeleton className="h-24 w-full" />
  </div>
)

const wrap = (el: React.ReactNode) => <Suspense fallback={fallback}>{el}</Suspense>

function Root() {
  return (
    <>
      <Outlet />
      <RouteAnnouncer />
    </>
  )
}

const pages = [
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
        element: wrap(<AppLayout />),
        children: [
          { index: true, element: wrap(<Dashboard />) },
          {
            element: wrap(<ContentRoute />),
            children: [
              { path: 'subjects', element: wrap(<Subjects />) },
              { path: 'subjects/:subjectId', element: wrap(<SubjectTopics />) },
              { path: 'practice', element: wrap(<PracticeSetup />) },
              { path: 'practice/play', element: wrap(<PracticePlayer />) },
              { path: 'revision', element: wrap(<Revision />) },
              { path: 'bookmarks', element: wrap(<Bookmarks />) },
              { path: 'notebook', element: wrap(<Notebook />) },
              { path: 'analytics', element: wrap(<Analytics />) },
              { path: 'mock', element: wrap(<MockSetup />) },
              { path: 'mock/run', element: wrap(<MockRun />) },
              { path: 'mock/result/:resultId', element: wrap(<MockResult />) },
            ],
          },
          { path: 'progress', element: wrap(<Progress />) },
          { path: 'workspace/subjects', element: wrap(<WorkspaceSubjects />) },
          { path: 'settings', element: wrap(<Settings />) },
          { path: 'admin', element: wrap(<Admin />) },
        ],
      },
    ],
  },
  { path: '*', element: wrap(<NotFound />) },
]

export const routes = [{ element: <Root />, children: pages }]

export default function App() {
  const router = useMemo(() => createBrowserRouter(routes, { basename: routerBasename() }), [])
  return (
    <AuthProvider client={supabase?.auth ?? null}>
      <PreviewBanner />
      <RouterProvider router={router} />
      <PwaPrompt />
    </AuthProvider>
  )
}
