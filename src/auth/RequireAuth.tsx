import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Skeleton } from '../components/ui'
import { useAuth } from './AuthContext'

/** Guards /app. Signed-out visitors are sent to sign-in and returned afterwards. */
export default function RequireAuth() {
  const { loading, session } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-6" role="status" aria-label="Loading">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
