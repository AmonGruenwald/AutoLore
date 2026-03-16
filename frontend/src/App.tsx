import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import BookWiki from './pages/BookWiki'
import SeriesWiki from './pages/SeriesWiki'
import Settings from './pages/Settings'
import Navbar from './components/Navbar'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/book/:bookId" element={<BookWiki />} />
          <Route path="/series/:seriesId" element={<SeriesWiki />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
