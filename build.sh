#!/bin/sh
# 빌드 + 새 버전 번호를 붙여 브라우저가 예전 파일을 쓰지 않게 함
set -e
npx esbuild src/main.js --bundle --minify --format=esm --target=es2020 --splitting --outdir=docs --entry-names=app --chunk-names=chunks/[name]-[hash] --log-level=error
V=$(cat docs/app.js docs/style.css | md5sum | cut -c1-8)
sed -i -E "s#href=\"style.css(\?v=[a-z0-9]+)?\"#href=\"style.css?v=$V\"#; s#src=\"app.js(\?v=[a-z0-9]+)?\"#src=\"app.js?v=$V\"#" docs/index.html
echo "built $V"
