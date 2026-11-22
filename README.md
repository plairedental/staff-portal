# 플레르치과 직원포털

- `src/main.js` 화면 코드 → `npm run build` 하면 `docs/app.js`로 묶임
- `docs/` GitHub Pages로 공개되는 사이트
- `firestore.rules` Firebase 보안 규칙 (Firebase 콘솔 > Firestore > 규칙에 적용)

역할: 관리자(admin) / 원장(doctor) / 총괄실장(chief) / 팀장(leader) / 직원(staff)
급여(`salaries`)는 본인과 관리자만 읽을 수 있음.
