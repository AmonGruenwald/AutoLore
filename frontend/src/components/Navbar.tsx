import { Link } from 'react-router-dom'
import { BookOpen, Settings } from 'lucide-react'

export default function Navbar() {
  return (
    <nav className="bg-ink text-parchment-100 px-6 py-3 flex items-center justify-between shadow-md">
      <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-wide hover:text-parchment-300 transition-colors">
        <BookOpen size={24} />
        AutoLore
      </Link>
      <Link to="/settings" className="flex items-center gap-1 text-sm hover:text-parchment-300 transition-colors">
        <Settings size={16} />
        Settings
      </Link>
    </nav>
  )
}
