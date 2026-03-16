#!/usr/bin/env bash
set -e

echo "=== AutoLore Dev Server ==="

# Check for Python
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 not found"
  exit 1
fi

# Check for Node
if ! command -v node &>/dev/null; then
  echo "ERROR: node not found"
  exit 1
fi

# Backend setup
echo "[backend] Installing dependencies..."
cd backend
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

echo "[backend] Starting on http://localhost:8000 ..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd ..

# Frontend setup
echo "[frontend] Installing dependencies..."
cd frontend
if [ ! -d "node_modules" ]; then
  npm install
fi

echo "[frontend] Starting on http://localhost:5173 ..."
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "AutoLore is running:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" INT TERM
wait
