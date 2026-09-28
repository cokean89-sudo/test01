#!/bin/bash
# RefBoard 실행기 (macOS) — Finder 에서 더블클릭하세요.
# 처음 실행할 때 Node.js 와 필요한 패키지를 설치하고, 준비되면 브라우저를 엽니다.

cd "$(dirname "$0")" || exit 1

pause_and_exit() {
  echo
  read -n 1 -s -r -p "아무 키나 누르면 창이 닫힙니다."
  exit "${1:-1}"
}

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'
}

echo "RefBoard 준비 중..."

if ! node_ok; then
  if command -v brew >/dev/null 2>&1; then
    echo "Node.js 를 설치합니다 (Homebrew)..."
    brew install node || brew upgrade node
  fi
  if ! node_ok; then
    echo "Node.js 22.13 이상이 필요합니다."
    echo "열리는 페이지에서 macOS 설치 파일(.pkg)을 받아 설치한 뒤, 이 파일을 다시 실행하세요."
    open "https://nodejs.org/ko/download"
    pause_and_exit 1
  fi
fi

if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "필요한 패키지를 설치합니다 (처음 한 번, 1~2분 걸립니다)..."
  npm install || pause_and_exit 1
fi

npm run app || pause_and_exit 1
