import { Link, useLocation } from 'react-router-dom'
import { BookOpen, Settings } from 'lucide-react'

export default function Navbar() {
  const { pathname } = useLocation()

  return (
    <nav className="h-12 bg-ink flex items-center justify-between px-6 shrink-0">
      <Link
        to="/"
        className="flex items-center gap-2 text-parchment-200 font-semibold tracking-tight hover:text-parchment-50 transition-colors"
      >
        <BookOpen size={17} strokeWidth={1.5} />
        AutoLore
      </Link>
      <Link
        to="/settings"
        className={[
          'flex items-center gap-1.5 text-xs transition-colors',
          pathname === '/settings'
            ? 'text-parchment-100'
            : 'text-parchment-400 hover:text-parchment-100',
        ].join(' ')}
      >
        <Settings size={13} />
        Settings
      </Link>
    </nav>
  )
}
