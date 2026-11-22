import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
  getDocs, query, where, orderBy, serverTimestamp
} from 'firebase/firestore/lite';

const app = initializeApp({
  apiKey: 'AIzaSyBQzIIEdv4Iu8xACElqTN5SI2oiC6GqWKU',
  authDomain: 'plairedental-clinic.firebaseapp.com',
  projectId: 'plairedental-clinic',
  storageBucket: 'plairedental-clinic.firebasestorage.app',
  messagingSenderId: '117623545923',
  appId: '1:117623545923:web:b57dc6805b606bce12b4f6'
});
const auth = getAuth(app);
const db = getFirestore(app);

const ROLES = { admin: '관리자', doctor: '원장', chief: '총괄실장', leader: '팀장', staff: '직원' };
const WORK = ['재직', '휴직', '퇴사'];

// ---------- 화면 설정 (글씨체·크기·색·이름·로고) ----------
const FONTS = {
  basic: { label: '기본', family: '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif' },
  pretendard: { label: '프리텐다드', family: 'Pretendard, sans-serif', css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css' },
  nanumgothic: { label: '나눔고딕', family: '"Nanum Gothic", sans-serif', css: 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&display=swap' },
  nanumsquare: { label: '나눔스퀘어', family: 'NanumSquare, sans-serif', css: 'https://cdn.jsdelivr.net/gh/moonspam/NanumSquare@2.0/nanumsquare.css' }
};
const SIZES = { normal: ['보통', 16], large: ['크게', 18], xlarge: ['아주 크게', 20] };
const COLORS = ['#1f7a74', '#2c4a8a', '#2b6cb0', '#6b46c1', '#b83280', '#c05621', '#8a5a2b', '#4a5568'];
const DEFAULT_THEME = { font: 'basic', size: 'normal', color: '#1f7a74', clinicName: '플레르치과', logo: '' };
let theme = { ...DEFAULT_THEME, ...JSON.parse(localStorage.getItem('theme') || '{}') };

function applyTheme() {
  const f = FONTS[theme.font] || FONTS.basic;
  if (f.css && !document.querySelector(`link[data-font="${theme.font}"]`)) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = f.css; l.dataset.font = theme.font;
    document.head.appendChild(l);
  }
  const mySize = me?.fontSize && SIZES[me.fontSize] ? me.fontSize : theme.size;
  const r = document.documentElement.style;
  r.setProperty('--font', f.family);
  r.setProperty('--c', theme.color);
  r.fontSize = (SIZES[mySize] || SIZES.normal)[1] + 'px';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme.color);
  document.title = theme.clinicName + ' 직원포털';
}
async function loadTheme() {
  try {
    const d = await getDoc(doc(db, 'settings', 'app'));
    theme = { ...DEFAULT_THEME, ...(d.exists() ? d.data() : {}) };
    localStorage.setItem('theme', JSON.stringify(theme));
  } catch (e) { console.warn('설정 불러오기 실패', e); }
  applyTheme();
}
function brand(cls = '') {
  return `<div class="brand ${cls}">${theme.logo ? `<img src="${theme.logo}" alt="">` : ''}${esc(theme.clinicName)}<span>직원포털</span></div>`;
}

const $app = document.getElementById('app');
let me = null;          // 내 users 문서 (+uid)
let view = 'home';      // home | my | hr | work | manual | perf | settings
let sub = null;         // 하위 화면 상태
let signingUp = false;  // 가입 처리 중에는 자동 로그인 처리 건너뜀

// ---------- 유틸 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (n || n === 0) && n !== '' ? Number(n).toLocaleString('ko-KR') + '원' : '-';
const can = {
  hr: () => me.role === 'admin',   // 직원 명부는 관리자만
  editHr: () => me.role === 'admin',
  editManual: () => ['admin', 'chief'].includes(me.role)
};
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
function authError(e) {
  const m = {
    'auth/invalid-email': '이메일 형식이 올바르지 않아요.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않아요.',
    'auth/wrong-password': '이메일 또는 비밀번호가 맞지 않아요.',
    'auth/user-not-found': '이메일 또는 비밀번호가 맞지 않아요.',
    'auth/email-already-in-use': '이미 가입된 이메일이에요.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 해요.',
    'auth/too-many-requests': '시도가 너무 많아요. 잠시 후 다시 해 주세요.',
    'auth/missing-password': '비밀번호를 입력해 주세요.'
  };
  return m[e.code] || '문제가 생겼어요: ' + (e.code || e.message);
}
const val = (id) => document.getElementById(id)?.value.trim() ?? '';

// ---------- 로그인 / 가입 ----------
function renderAuth(mode = 'login', msg = '') {
  const signup = mode === 'signup';
  $app.innerHTML = `
    <div class="auth">
      ${brand()}
      <form id="f" class="card">
        ${signup ? `<label>이름<input id="name" required autocomplete="name"></label>
                    <label>연락처<input id="phone" inputmode="tel" placeholder="010-0000-0000"></label>` : ''}
        <label>이메일<input id="email" type="email" required autocomplete="email"></label>
        <label>비밀번호<input id="pw" type="password" required minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
        ${msg ? `<p class="msg">${esc(msg)}</p>` : ''}
        <button class="primary">${signup ? '가입 신청' : '로그인'}</button>
      </form>
      <div class="links">
        ${signup ? `<a href="#" id="toLogin">로그인으로 돌아가기</a>`
                 : `<a href="#" id="toSignup">처음이에요 (가입)</a><a href="#" id="reset">비밀번호 찾기</a>`}
      </div>
    </div>`;
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button'); btn.disabled = true;
    try {
      if (signup) {
        signingUp = true;
        const cred = await createUserWithEmailAndPassword(auth, val('email'), document.getElementById('pw').value);
        await setDoc(doc(db, 'users', cred.user.uid), {
          name: val('name'), email: val('email'), phone: val('phone'),
          role: 'staff', status: 'pending', createdAt: serverTimestamp()
        });
        signingUp = false;
        await loadMe(cred.user);
      } else {
        await signInWithEmailAndPassword(auth, val('email'), document.getElementById('pw').value);
      }
    } catch (e) { signingUp = false; renderAuth(mode, authError(e)); }
  };
  document.getElementById('toSignup')?.addEventListener('click', (e) => { e.preventDefault(); renderAuth('signup'); });
  document.getElementById('toLogin')?.addEventListener('click', (e) => { e.preventDefault(); renderAuth('login'); });
  document.getElementById('reset')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = val('email');
    if (!email) return renderAuth('login', '이메일을 먼저 입력한 뒤 "비밀번호 찾기"를 눌러 주세요.');
    try { await sendPasswordResetEmail(auth, email); renderAuth('login', '비밀번호 재설정 메일을 보냈어요. 메일함을 확인해 주세요.'); }
    catch (err) { renderAuth('login', authError(err)); }
  });
}

function renderWaiting() {
  const quit = me.status === 'active' && me.work === '퇴사';
  const rejected = me.status === 'rejected' || quit;
  $app.innerHTML = `
    <div class="auth">
      ${brand()}
      <div class="card center">
        <p class="big">${quit ? '퇴사 처리된 계정이에요.' : rejected ? '가입이 승인되지 않았어요.' : '가입 신청이 완료됐어요.'}</p>
        <p>${rejected ? '관리자에게 문의해 주세요.' : '관리자가 승인하면 바로 사용할 수 있어요.<br>승인 후 이 화면을 새로고침해 주세요.'}</p>
        <button id="reload" class="primary">새로고침</button>
        <button id="out" class="ghost">로그아웃</button>
      </div>
    </div>`;
  document.getElementById('reload').onclick = () => location.reload();
  document.getElementById('out').onclick = () => signOut(auth);
}

// ---------- 화면 틀: 상단 카테고리 + 좌측 메뉴 ----------
// 메뉴 항목: [키, 이름, 아이콘, 설명, 보이는 조건]
function categories() {
  const f = (items) => (items || []).filter((i) => !i[4] || i[4]());
  return [
    { key: 'biz', label: '경영·통계', icon: '📊', show: () => me.role === 'admin', items: [
      ['perf', '성과·인센티브', '📈', '팀별 목표 매출과 인센티브를 확인해요. (준비 중)']
    ] },
    { key: 'hr', label: '인사관리', icon: '👥', items: [
      ['work:schedule', '근무표', '🗓️', '그날 쉬는 사람을 달력으로 확인해요.'],
      ['org', '조직도', '🏥', '부서·팀 구성과 담당 업무를 확인해요.'],
      ['work:leave', '내 연차', '🌴', '연차를 신청하고 남은 일수를 확인해요.'],
      ['slips', '내 급여명세서', '🧾', '매달 내 급여명세서를 확인하고 인쇄해요.'],
      ['docreq', '서류 신청', '📨', '재직증명서 발급을 신청해요.']
    ], admin: [
      ['work:all', '연차 승인·현황', '✅', '직원 연차 신청을 승인하고 사용 현황을 봐요.', canApprove],
      ['hr', '직원 명부', '📇', '직원 정보, 연봉, 가입 승인을 관리해요.', can.hr],
      ['payroll', '직원 급여 관리', '💰', '전체 직원 급여대장과 총 인건비를 봐요.', () => me.role === 'admin'],
      ['docs', '서류 발급', '🖨️', '근로계약서·재직증명서를 만들어 인쇄해요.', () => me.role === 'admin']
    ] },
    { key: 'manual', label: '원내매뉴얼', icon: '📘', items: [
      ['manual', '홈', '🏠', '매뉴얼을 만든 이유와 읽는 법이에요.'],
      ['m:check', '진료 준비 체크리스트', '✅', '접수부터 환자 교체까지 순서대로 확인해요.'],
      ['m:notes', '직원 성찰노트', '📝', '실수와 개선 계획을 함께 나눠요.'],
      ['m:log', '매뉴얼 업데이트 리뷰', '🔄', '언제 무엇이 바뀌었는지 봐요.'],
      ['m:req', '개선 요청', '💬', '매뉴얼에 대한 의견을 남겨요.']
    ], admin: [
      ['m:new', '새 매뉴얼 페이지', '✏️', '새 페이지를 직접 써요.', can.editManual],
      ['m:admin', '목차·가져오기', '🗂️', '목차 순서를 바꾸고 매뉴얼 파일을 가져와요.', can.editManual]
    ] }
  ].filter((c) => !c.show || c.show())
   .map((c) => ({ ...c, items: f(c.items), admin: f(c.admin) }));
}
// 좌측 아래: 관리자 메뉴(카테고리마다 다름) → 맨 아래 내 계정
const GLOBAL_ADMIN = () => [['settings', '화면 설정', '🎨', '글씨체, 색상, 로고를 바꿔요.', () => me.role === 'admin']].filter((i) => i[4]());
const MY_ITEMS = [
  ['my', '마이페이지', '👤', '내 기본정보, 연봉, 글씨 크기를 확인해요.'],
  ['security', '보안정책', '🛡️', '내 정보가 어떻게 보호되는지 확인해요.']
];
let lastCat = 'hr';
const curKey = () => {
  if (view === 'work') return 'work:' + (sub?.tab || 'schedule');
  if (view === 'manual') {
    if (sub?.edit === null) return 'm:new';
    const id = sub?.edit ?? sub?.id;
    if (id === '_check') return 'm:check';
    if (id === '_home') return 'manual';
    if (id) return 'mp:' + id;
    return sub?.tab ? 'm:' + sub.tab : 'manual';
  }
  return view;
};
const catOf = (key) => categories().find((c) => (c.key === 'manual' && /^mp?:/.test(key)) || [...c.items, ...c.admin].some((i) => i[0] === key));
function goKey(key) {
  if (key === 'work:schedule') return go('work', { tab: 'schedule' });
  if (key === 'work:leave') return go('work', { tab: 'leave' });
  if (key === 'work:all') return go('work', { tab: 'all' });
  if (key === 'm:new') return go('manual', { edit: null });
  if (key.startsWith('mp:')) return go('manual', { id: key.slice(3) });
  if (key.startsWith('m:')) return go('manual', { tab: key.slice(2) });
  go(key);
}

function shell(content) {
  const cats = categories();
  const key = curKey();
  const hit = catOf(key);
  if (hit) lastCat = hit.key;
  const cat = hit || cats.find((c) => c.key === lastCat) || cats[0];
  const btn = ([k, t, i]) => `<button data-k="${k}" class="${key === k ? 'on' : ''}"><i>${i}</i>${t}</button>`;
  $app.innerHTML = `
    <header class="top">
      <a href="#" id="home" class="homeLink">${brand('small')}</a>
      <nav class="cats">${cats.map((c) => `<button data-cat="${c.key}" class="${hit?.key === c.key ? 'on' : ''}"><i>${c.icon}</i>${c.label}</button>`).join('')}</nav>
      <div class="who">
        <a href="#" id="me">${esc(me.name)} <small>${ROLES[me.role]}</small></a>
        <button id="out" class="ghost sm">로그아웃</button>
      </div>
    </header>
    <div class="body">
      <aside class="side ${cat.key === 'manual' ? 'mcat' : ''}">
        <div class="sideTop">
          <div class="sideTitle">${cat.icon} ${cat.label}</div>
          ${cat.items.map((i) => i[0] === 'm:log' && mcache?.pending ? btn(i).replace('</button>', ` <span class="badgeN">${mcache.pending}</span></button>`) : btn(i)).join('')}
          ${cat.key === 'manual' ? manualSide(key) : ''}
        </div>
        <div class="sideBottom">
          ${[...cat.admin, ...GLOBAL_ADMIN()].length ? `<div class="sideGroup"><div class="sideTitle">🔒 관리자 메뉴</div>${[...cat.admin, ...GLOBAL_ADMIN()].map((i) => i[0] === 'docs' && docPending ? btn(i).replace('</button>', ` <span class="badgeN">${docPending}</span></button>`) : btn(i)).join('')}</div>` : ''}
          <div class="sideGroup"><div class="sideTitle">👤 내 계정</div>${MY_ITEMS.map(btn).join('')}</div>
        </div>
      </aside>
      <main class="${['work:schedule', 'payroll', 'work:all', 'org', 'm:log', 'docs'].includes(key) ? 'wide' : ''}">${content}</main>
    </div>`;
  $app.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => goKey(cats.find((c) => c.key === b.dataset.cat).items[0][0]));
  $app.querySelectorAll('aside [data-k]').forEach((b) => b.onclick = () => goKey(b.dataset.k));
  if (cat.key === 'manual') bindManualSide();
  document.getElementById('home').onclick = (e) => { e.preventDefault(); go('home'); };
  document.getElementById('me').onclick = (e) => { e.preventDefault(); go('my'); };
  document.getElementById('out').onclick = () => signOut(auth);
}
function go(v, s = null) { view = v; sub = s; render(); window.scrollTo(0, 0); }

function renderHome() {
  const cats = [...categories().map((c) => ({ ...c, items: [...c.items, ...c.admin.map((i) => [i[0], '🔒 ' + i[1], i[2], i[3]])] })),
    { label: '내 계정', icon: '👤', items: [...MY_ITEMS, ...GLOBAL_ADMIN()] }];
  shell(`
    <div class="welcome">${theme.logo ? `<img src="${theme.logo}" alt="">` : `<span class="badge">${esc((theme.clinicName || '치')[0])}</span>`}
      <p><b>${esc(me.name)}</b> ${ROLES[me.role]}님,<br>${esc(theme.clinicName)}에 오신 것을 환영합니다.</p></div>
    ${cats.map((c) => `
      <h2 class="catHead">${c.icon} ${c.label}</h2>
      <div class="cards">${c.items.map(([k, t, i, d]) => `<button class="hcard" data-k="${k}"><span class="ic">${i}</span><b>${t}</b><small>${d}</small></button>`).join('')}</div>`).join('')}`);
  $app.querySelectorAll('main [data-k]').forEach((b) => b.onclick = () => goKey(b.dataset.k));
}

function renderPerf() {
  shell(`<h1>성과·인센티브</h1>
    <section class="card"><p class="big">준비 중이에요</p>
      <p>다음 단계에서 만들 예정이에요.</p>
      <ul class="muted"><li>전체·팀별 목표 매출 (인건비의 3~4배, 조정 가능)</li><li>덴트웹 엑셀을 올리면 팀별 매출·달성률 자동 계산</li><li>초과분 20% 팀 인센티브, 팀장 분배(최대 70%)</li><li>월별 인센티브 지급 내역</li></ul>
    </section>`);
}

async function render() {
  shell('<p class="muted">불러오는 중…</p>');
  try {
    if (view === 'hr' && can.hr()) return await renderHr();
    if (view === 'manual') return await renderManual();
    if (view === 'work') return await renderWork();
    if (view === 'settings' && me.role === 'admin') return renderSettings();
    if (view === 'perf' && me.role === 'admin') return renderPerf();
    if (view === 'payroll' && me.role === 'admin') return await renderPayroll();
    if (view === 'docs' && me.role === 'admin') return await renderDocs();
    if (view === 'docreq') return await renderDocReq();
    if (view === 'slips') return await renderMySlips();
    if (view === 'security') return renderSecurity();
    if (view === 'org') return await renderOrg();
    if (view === 'my') return await renderMy();
    view = 'home'; return renderHome();
  } catch (e) {
    console.error(e);
    shell(`<p class="msg">불러오지 못했어요. (${esc(e.code || e.message)})</p>`);
  }
}

// ---------- 내 정보 ----------
function infoRows(u) {
  return `
    <dl class="info">
      <dt>이름</dt><dd>${esc(u.name)}</dd>
      <dt>직무</dt><dd>${esc(u.job) || '-'}</dd>
      <dt>부서</dt><dd>${esc(u.dept) || '-'}</dd>
      <dt>팀</dt><dd>${esc(u.team) || '-'}</dd>
      <dt>역할</dt><dd>${ROLES[u.role] || '-'}</dd>
      <dt>연락처</dt><dd>${esc(u.phone) || '-'}</dd>
      <dt>이메일</dt><dd>${esc(u.email)}</dd>
      <dt>입사일</dt><dd>${esc(u.hireDate) || '-'}</dd>
      <dt>재직상태</dt><dd>${esc(u.work) || '재직'}</dd>
    </dl>`;
}
async function renderMy() {
  const s = await getDoc(doc(db, 'salaries', me.uid));
  const sal = s.exists() ? s.data() : null;
  shell(`
    <p class="eyebrow">MY PAGE</p><h1>마이페이지</h1>
    <section class="card">${infoRows(me)}
      <div class="row"><input id="phone" value="${esc(me.phone)}" placeholder="연락처"><button id="savePhone">연락처 저장</button></div>
    </section>
    <section class="card">
      <h2>내 글씨 크기</h2>
      <div class="chips" id="mySize">
        ${[['', '기본'], ...Object.entries(SIZES).map(([k, v]) => [k, v[0]])].map(([k, t]) => `<button data-s="${k}" class="${(me.fontSize || '') === k ? 'on' : ''}">${t}</button>`).join('')}
      </div>
      <p class="muted sm">이 기기와 내 계정에만 적용돼요. '기본'은 관리자가 정한 크기예요.</p>
    </section>
    <section class="card">
      <h2>연봉</h2>
      ${sal && (sal.annual || sal.monthly) ? `<dl class="info">
        ${sal.annual ? `<dt>연봉</dt><dd>${won(sal.annual)}</dd>` : ''}
        <dt>세전 월급여</dt><dd>${won(sal.annual ? Math.round(sal.annual / 12) : sal.monthly)}</dd>
        ${sal.annualDate ? `<dt>적용(입력)일</dt><dd>${sal.annualDate}</dd>` : ''}
        ${sal.note ? `<dt>메모</dt><dd>${esc(sal.note)}</dd>` : ''}</dl>`
        : '<p class="muted">아직 등록된 연봉 정보가 없어요.</p>'}
      ${sal && (sal.address || sal.bankAccount) ? `<dl class="info">${sal.address ? `<dt>주소</dt><dd>${esc(sal.address)}</dd>` : ''}${sal.bankAccount ? `<dt>급여계좌</dt><dd>${esc(sal.bankName || '')} ${esc(sal.bankAccount)}${sal.bankHolder ? ` (${esc(sal.bankHolder)})` : ''}</dd>` : ''}</dl>` : ''}
      <p class="muted sm">연봉·주소·급여계좌는 본인과 관리자만 볼 수 있어요. 바뀐 내용이 있으면 관리자에게 알려 주세요. 매달 급여명세서는 "급여" 메뉴에서 확인하세요.</p>
    </section>`);
  document.getElementById('savePhone').onclick = async () => {
    await updateDoc(doc(db, 'users', me.uid), { phone: val('phone') });
    me.phone = val('phone'); toast('저장했어요');
  };
  $app.querySelectorAll('#mySize button').forEach((b) => b.onclick = async () => {
    me.fontSize = b.dataset.s;
    await updateDoc(doc(db, 'users', me.uid), { fontSize: me.fontSize });
    applyTheme(); render();
  });
}

// ---------- 인사관리 ----------
function tenure(hire) {
  if (!hire) return '<span class="muted">-</span>';
  const h = parseD(hire), t = new Date();
  let m = (t.getFullYear() - h.getFullYear()) * 12 + t.getMonth() - h.getMonth();
  if (t.getDate() < h.getDate()) m--;
  if (m < 0) return '입사 전';
  const y = Math.floor(m / 12), r = m % 12;
  return y ? `${y}년${r ? ` ${r}개월` : ''}` : `${r}개월`;
}
async function loadPeople() {
  const col = collection(db, 'users');
  const q = me.role === 'leader' ? query(col, where('team', '==', me.team || '')) : col;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
}

async function renderHr() {
  if (sub?.uid) return renderPerson(sub.uid);
  const people = await loadPeople();
  const pending = people.filter((p) => p.status === 'pending');
  const roster = people.filter((p) => p.status === 'roster');
  const staff = people.filter((p) => p.status === 'active' || p.status === 'roster');
  const order = orgOrder(await loadOrg());
  const rankOf = (n) => { const i = order.findIndex((o) => o.name === n); return i < 0 ? 999 : i; };
  const shown = (sub?.showAll ? staff : staff.filter((p) => (p.work || '재직') !== '퇴사'))
    .sort((a, b) => rankOf(a.name) - rankOf(b.name) || a.name.localeCompare(b.name, 'ko'));
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const matchOf = (p) => roster.find((r) => r.email && p.email && r.email.toLowerCase() === p.email.toLowerCase())
    || roster.find((r) => digits(r.phone) && digits(r.phone) === digits(p.phone))
    || roster.find((r) => r.name && r.name === p.name);

  shell(`
    <div class="row between"><div><p class="eyebrow">STAFF LIST</p><h1>직원 명부</h1></div>${can.editHr() ? '<div class="row"><label class="upload ghostUp">📥 기존 직원명부 엑셀로 채우기<input type="file" id="rosterX" accept=".xlsx,.xls" hidden></label><button id="add" class="primary">+ 직원 추가</button></div>' : ''}</div>
    ${can.editHr() && pending.length ? `
      <section class="card warn">
        <h2>가입 승인 대기 (${pending.length})</h2>
        ${pending.map((p) => { const m = matchOf(p); return `
          <div class="pending">
            <div><b>${esc(p.name)}</b> <span class="muted sm">${esc(p.email)} ${esc(p.phone)}</span></div>
            <label class="sm">연결할 직원 명부
              <select id="l_${p.uid}" data-link="${p.uid}">
                <option value="">명부에 없음 (새 직원으로 등록)</option>
                ${roster.map((r) => `<option value="${r.uid}" ${m?.uid === r.uid ? 'selected' : ''}>${esc(r.name)}${r.team ? ' · ' + esc(r.team) : ''}${r.phone ? ' · ' + esc(r.phone) : ''}</option>`).join('')}
              </select></label>
            <div class="row" id="rt_${p.uid}" style="${m ? 'display:none' : ''}">
              <select id="r_${p.uid}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === 'staff' ? 'selected' : ''}>${v}</option>`).join('')}</select>
              <input id="t_${p.uid}" placeholder="팀 (예: 진료1팀)">
            </div>
            <p class="muted sm" id="hint_${p.uid}">${m ? '명부에 입력해 둔 정보(역할, 팀, 입사일, 급여 등)가 이 계정으로 옮겨져요.' : ''}</p>
            <div class="row"><button data-ok="${p.uid}" class="primary">승인</button><button data-no="${p.uid}" class="ghost">거절</button></div>
          </div>`; }).join('')}
      </section>` : ''}
    <section class="card">
      <div class="row between"><h2>직원 ${shown.length}명${roster.length ? ` <span class="muted sm">(미가입 ${roster.length})</span>` : ''}</h2>
        <label class="sm"><input type="checkbox" id="showAll" ${sub?.showAll ? 'checked' : ''}> 퇴사자 포함</label></div>
      <div class="tbl"><table class="staffT">
        <tr><th>이름</th><th>직무</th><th>팀</th><th>역할</th><th>입사일</th><th>근속기간</th><th>상태</th>${can.editHr() ? '<th></th>' : ''}</tr>
        ${shown.map((p) => `<tr>
          <td><a href="#" data-p="${p.uid}"><b>${esc(p.name)}</b></a></td>
          <td>${esc(p.job || '-')}</td><td>${esc(p.team || '-')}</td><td><span class="tag">${ROLES[p.role] || '직원'}</span></td>
          <td>${p.hireDate || '<span class="muted">-</span>'}</td><td>${tenure(p.hireDate)}</td>
          <td>${p.status === 'roster' ? '<span class="tag gray">미가입</span>' : ''}${(p.work && p.work !== '재직') ? ` <span class="tag gray">${esc(p.work)}</span>` : ''}</td>
          ${can.editHr() ? `<td class="nowrap"><button data-p="${p.uid}" class="ghost sm">✏️ 수정</button>${p.uid !== me.uid ? `<button data-delp="${p.uid}" class="ghost sm danger">🗑️ 삭제</button>` : ''}</td>` : ''}
        </tr>`).join('') || '<tr><td colspan="8" class="muted">아직 직원이 없어요.</td></tr>'}
      </table></div>
      <p class="muted sm">조직도 순서로 보여요. 퇴사한 직원은 삭제보다 재직상태를 "퇴사"로 바꾸는 걸 권해요.</p>
    </section>`);

  $app.querySelectorAll('[data-p]').forEach((b) => b.onclick = (e) => { e.preventDefault(); go('hr', { uid: b.dataset.p }); });
  $app.querySelectorAll('[data-delp]').forEach((b) => b.onclick = async () => {
    const p = people.find((x) => x.uid === b.dataset.delp);
    if (!confirm(`${p.name} 님을 직원 명부에서 삭제할까요?\n연봉·주소·계좌 정보도 함께 지워지고 되돌릴 수 없어요.\n(퇴사자는 삭제 대신 재직상태를 "퇴사"로 바꾸는 걸 권해요)`)) return;
    await deleteDoc(doc(db, 'salaries', p.uid)).catch(() => {});
    await deleteDoc(doc(db, 'users', p.uid));
    toast('삭제했어요'); go('hr', sub?.showAll ? { showAll: true } : null);
  });
  document.getElementById('add')?.addEventListener('click', () => go('hr', { uid: 'new' }));
  document.getElementById('rosterX')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const rows = await importRosterExcel(f, people);
      const hit = rows.filter((r) => r.p), miss = rows.filter((r) => !r.p);
      if (!hit.length) { alert('직원 명부와 이름이 같은 직원을 찾지 못했어요.'); return; }
      if (!confirm(`${hit.length}명의 주민등록번호·주소·계약기간을 채울까요?\n(${hit.map((r) => r.name).join(', ')})` +
        (miss.length ? `\n\n명부에 없어서 건너뛸 사람: ${miss.map((r) => r.name).join(', ')}` : '') +
        '\n\n연락처·부서·직위·입사일·연봉은 비어 있는 칸만 채워요.')) return;
      const n = await applyRosterRows(rows);
      toast(`${n}명의 정보를 채웠어요`); renderHr();
    } catch (er) { console.error(er); alert(er.message || '엑셀을 읽지 못했어요.'); }
  });
  document.getElementById('showAll').onchange = (e) => go('hr', { showAll: e.target.checked });
  $app.querySelectorAll('[data-link]').forEach((s) => s.onchange = () => {
    const uid = s.dataset.link;
    document.getElementById('rt_' + uid).style.display = s.value ? 'none' : '';
    document.getElementById('hint_' + uid).textContent = s.value ? '명부에 입력해 둔 정보(역할, 팀, 입사일, 급여 등)가 이 계정으로 옮겨져요.' : '';
  });
  $app.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
    const uid = b.dataset.ok;
    const linkId = val('l_' + uid);
    b.disabled = true;
    if (linkId) {
      const p = pending.find((x) => x.uid === uid);
      const r = roster.find((x) => x.uid === linkId);
      await linkRoster(r, p);
    } else {
      await updateDoc(doc(db, 'users', uid), {
        status: 'active', role: document.getElementById('r_' + uid).value, team: val('t_' + uid), work: '재직'
      });
    }
    toast('승인했어요'); render();
  });
  $app.querySelectorAll('[data-no]').forEach((b) => b.onclick = async () => {
    if (!confirm('가입을 거절할까요?')) return;
    await updateDoc(doc(db, 'users', b.dataset.no), { status: 'rejected' });
    toast('거절했어요'); render();
  });
}

// 미리 입력한 명부(r)를 가입한 계정(p)에 연결: 정보·급여·근무표를 옮기고 명부는 지움
async function linkRoster(r, p) {
  const keep = ['name', 'job', 'dept', 'team', 'role', 'hireDate', 'work', 'annualAdjust'];
  const data = { status: 'active', phone: r.phone || p.phone || '' };
  keep.forEach((k) => { if (r[k] !== undefined && r[k] !== '') data[k] = r[k]; });
  data.role ||= 'staff'; data.work ||= '재직';
  await updateDoc(doc(db, 'users', p.uid), data);
  const s = await getDoc(doc(db, 'salaries', r.uid));
  if (s.exists()) { await setDoc(doc(db, 'salaries', p.uid), s.data()); await deleteDoc(doc(db, 'salaries', r.uid)); }
  const sch = await getDocs(collection(db, 'schedules'));
  for (const d of sch.docs) {
    const x = d.data();
    const inPeople = (x.people || []).some((q) => q.uid === r.uid);
    if (!inPeople && !x.cells?.[r.uid]) continue;
    x.people = (x.people || []).map((q) => q.uid === r.uid ? { ...q, uid: p.uid } : q);
    if (x.cells?.[r.uid]) { x.cells[p.uid] = { ...(x.cells[p.uid] || {}), ...x.cells[r.uid] }; delete x.cells[r.uid]; }
    await setDoc(d.ref, x);
  }
  const pay = await getDocs(collection(db, 'payroll'));
  for (const d of pay.docs) {
    const x = d.data();
    if (!x.rows?.[r.uid]) continue;
    x.rows[p.uid] = x.rows[r.uid]; delete x.rows[r.uid];
    await setDoc(d.ref, x);
  }
  for (const d of (await getDocs(query(collection(db, 'leaves'), where('uid', '==', r.uid)))).docs) await updateDoc(d.ref, { uid: p.uid });
  for (const d of (await getDocs(query(collection(db, 'leaveFiles'), where('uid', '==', r.uid)))).docs) await updateDoc(d.ref, { uid: p.uid });
  const slips = await getDocs(query(collection(db, 'payslips'), where('uid', '==', r.uid)));
  for (const d of slips.docs) {
    const x = d.data();
    await setDoc(doc(db, 'payslips', `${x.month}_${p.uid}`), { ...x, uid: p.uid });
    await deleteDoc(d.ref);
  }
  await deleteDoc(doc(db, 'users', r.uid));
}

async function renderPerson(uid) {
  const isNew = uid === 'new';
  let p = { uid, name: '', role: 'staff', status: 'roster' };
  if (!isNew) {
    const d = await getDoc(doc(db, 'users', uid));
    if (!d.exists()) return go('hr');
    p = { uid, ...d.data() };
  }
  const isRoster = p.status === 'roster';
  const back = '<button id="back" class="ghost">← 목록</button>';

  if (!can.editHr()) {
    shell(`${back}<h1>${esc(p.name)}</h1><section class="card">${infoRows(p)}</section>`);
    document.getElementById('back').onclick = () => go('hr');
    return;
  }

  let sal = {};
  if (!isNew) { const s = await getDoc(doc(db, 'salaries', uid)); sal = s.exists() ? s.data() : {}; }
  const tmP = {}; ((await loadOrg()).groups || []).forEach((g) => (g.members || []).forEach((m) => { tmP[m.name] = m.title || ''; }));
  const f = (id, label, v, type = 'text') => `<label>${label}<input id="${id}" type="${type}" value="${esc(v ?? '')}"></label>`;
  shell(`
    ${back}<h1>${isNew ? '직원 추가' : esc(p.name)}</h1>
    ${isRoster ? '<p class="muted sm">아직 가입하지 않은 직원이에요. 나중에 이 직원이 가입하면 승인할 때 이 명부와 연결돼요. 이메일이나 연락처를 넣어 두면 자동으로 찾아줘요.</p>' : ''}
    <section class="card form">
      ${f('name', '이름', p.name)}
      ${f('job', '직무 (예: 치과위생사)', p.job)}
      ${f('dept', '부서 (예: 진료실, 데스크)', p.dept)}
      ${f('team', '팀', p.team)}
      <label>역할<select id="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${f('phone', '연락처', p.phone)}
      ${isRoster ? f('email', '이메일 (가입할 때 쓸 이메일)', p.email, 'email') : `<label>이메일<input value="${esc(p.email)}" disabled></label>`}
      ${f('hireDate', '입사일', p.hireDate, 'date')}
      <label>재직상태<select id="work">${WORK.map((w) => `<option ${(p.work || '재직') === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
      ${f('leaveDate', '퇴사일 (퇴사자만)', p.leaveDate, 'date')}
      ${f('annualAdjust', '연차 조정 (일, 예: 2 또는 -1)', p.annualAdjust ?? '', 'number')}
      <label class="row sm"><input type="checkbox" id="noLeave" ${noLeave(p, tmP) ? 'checked' : ''}> 연차 대상 아님 (연차 현황 목록에서 빼기)</label>
    </section>
    <section class="card form">
      <h2>연봉 <span class="muted sm">(본인과 관리자만 볼 수 있어요)</span></h2>
      <label>연봉 (원)
        <div class="row"><input id="annual" inputmode="numeric" value="${sal.annual ? comma(sal.annual) : ''}" placeholder="예: 36,000,000">
          <span class="stamp">${sal.annualDate ? `📅 ${sal.annualDate} 입력${sal.annualBy ? ' · ' + esc(sal.annualBy) : ''}` : '아직 입력 안 됨'}</span></div></label>
      <label>세전 월급여 (연봉 ÷ 12, 자동 계산)<input id="monthlyView" disabled value="${sal.annual ? comma(Math.round(sal.annual / 12)) + '원' : sal.monthly ? comma(sal.monthly) + '원' : ''}"></label>
      ${f('note', '메모 (예: 식대 포함, 2026년 연봉협상)', sal.note ?? '')}
    </section>
    <section class="card form">
      <h2>주민등록번호 · 주소 · 계약 · 급여계좌 <span class="muted sm">(본인과 관리자만 볼 수 있어요)</span></h2>
      ${f('rrn', '주민등록번호 (근로계약서·재직증명서에 들어가요)', sal.rrn ?? '')}
      ${f('address', '주소', sal.address ?? '')}
      <div class="two">${f('contractStart', '계약 시작일', sal.contractStart ?? '', 'date')}${f('contractEnd', '계약 만료일 (없으면 비워 두기)', sal.contractEnd ?? '', 'date')}</div>
      <div class="two">${f('bankName', '은행', sal.bankName ?? '')}${f('bankHolder', '예금주', sal.bankHolder ?? '')}</div>
      ${f('bankAccount', '계좌번호', sal.bankAccount ?? '')}
      ${(sal.history || []).length ? `<div class="hist"><b class="sm">연봉 변경 이력</b>
        ${[...sal.history].reverse().map((h) => `<div class="sm"><span>${h.date}</span><span>${comma(h.annual)}원</span><span class="muted">${esc(h.by || '')}</span></div>`).join('')}</div>` : ''}
    </section>
    <div class="row"><button id="save" class="primary">${isNew ? '추가' : '저장'}</button>
      ${!isNew && uid !== me.uid ? `<button id="del" class="ghost danger">${isRoster ? '명부에서 삭제' : '계정 정보 삭제'}</button>` : ''}</div>`);

  document.getElementById('back').onclick = () => go('hr');
  const an = document.getElementById('annual');
  an.oninput = () => { const v = num(an.value); document.getElementById('monthlyView').value = v ? comma(Math.round(v / 12)) + '원' : ''; };
  an.onblur = () => { an.value = num(an.value) ? comma(num(an.value)) : ''; };
  document.getElementById('save').onclick = async () => {
    if (!val('name')) return toast('이름을 입력해 주세요');
    const data = {
      name: val('name'), job: val('job'), dept: val('dept'), team: val('team'),
      role: document.getElementById('role').value, phone: val('phone'),
      hireDate: val('hireDate'), work: document.getElementById('work').value, leaveDate: val('leaveDate'),
      annualAdjust: val('annualAdjust') === '' ? 0 : Number(val('annualAdjust')),
      noLeave: document.getElementById('noLeave').checked
    };
    if (isRoster) data.email = val('email');
    let id = uid;
    if (isNew) { const r = await addDoc(collection(db, 'users'), { ...data, status: 'roster', createdAt: serverTimestamp() }); id = r.id; }
    else await updateDoc(doc(db, 'users', uid), data);
    const annual = num(val('annual'));
    const priv = { rrn: val('rrn'), address: val('address'), contractStart: val('contractStart'), contractEnd: val('contractEnd'), bankName: val('bankName'), bankHolder: val('bankHolder'), bankAccount: val('bankAccount') };
    if (annual || val('note') || Object.values(priv).some(Boolean) || !isNew) {
      const next = { ...sal, ...priv, note: val('note'), updatedAt: serverTimestamp() };
      if (annual !== num(sal.annual)) {   // 연봉이 바뀌면 오늘 날짜와 함께 이력에 남김
        next.annual = annual || null;
        next.monthly = annual ? Math.round(annual / 12) : null;
        next.annualDate = ymd(new Date()); next.annualBy = me.name;
        next.history = [...(sal.history || []), { annual, date: next.annualDate, by: me.name }];
      }
      await setDoc(doc(db, 'salaries', id), next);
    }
    if (id === me.uid) await loadMe(auth.currentUser, false);
    toast(isNew ? '추가했어요' : '저장했어요');
    go('hr');
  };
  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm(`${p.name} 님의 정보를 삭제할까요?${isRoster ? '' : " 퇴사자는 삭제 대신 재직상태를 '퇴사'로 바꾸는 걸 권해요."}`)) return;
    await deleteDoc(doc(db, 'salaries', uid)).catch(() => {});
    await deleteDoc(doc(db, 'users', uid));
    toast('삭제했어요'); go('hr');
  });
}

// ---------- 서류 발급 (근로계약서·재직증명서) — 관리자만 ----------
// 사업장 정보: settings/company · 직원 개인정보(주민등록번호·주소·계약기간·연봉): salaries/{uid} (본인과 관리자만)
const COMPANY_FIELDS = [['name', '사업체명', '예: ○○치과'], ['ceo', '대표자', '예: 홍길동'], ['bizNo', '사업자등록번호', '000-00-00000'],
  ['addr', '소재지', '사업장 주소'], ['bizType', '업태 / 종목', '보건업 / 치과의원'], ['tel', 'TEL', ''], ['fax', 'FAX', '']];
const won2 = (n) => n || n === 0 ? comma(n) + '원' : '';
const krDate = (s) => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}년 ${m[2]}월 ${m[3]}일` : ''; };
// 월급에서 식대를 빼고 80%는 기본급(천 원 단위 반올림), 나머지는 고정연장수당 (기존 명부 계산 방식)
function paySplit(annual, meal = 200000) {
  const month = annual ? Math.round(annual / 12) : 0;
  if (!month) return { month: 0, base: 0, ot: 0, meal };
  const base = Math.round(((month - meal) * 0.8) / 1000) * 1000;
  return { month, base, ot: month - meal - base, meal };
}

const telFmt = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 ? d.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') : d.length === 10 ? d.replace(/(\d{2,3})(\d{3,4})(\d{4})/, '$1-$2-$3') : p; };
function contractHtml(v, co) {
  const t = (s) => esc(s || '');
  const period = `${krDate(v.start) || '&nbsp;'} ~ ${v.end ? krDate(v.end) : '기간의 정함 없음'}`;
  return `<div class="paper contract">
  <h2>표준 근로계약서</h2>
  <p>${t(co.name)} 대표원장 ${t(co.ceo)} (이하 '사업주'라 함)과 근로자 (이하 '근로자'라 함)는 상호 신의성실의 원칙에 입각하여 다음과 같이 근로계약을 체결하고 이를 성실히 이행할 것을 확약한다.</p>
  <table class="dt info4"><colgroup><col style="width:12%"><col style="width:21%"><col style="width:15%"><col style="width:52%"></colgroup><tr><th>성명</th><td>${t(v.name)}</td><th>주민등록번호</th><td>${t(v.rrn)}</td></tr>
    <tr><th>연락처</th><td>${t(telFmt(v.phone))}</td><th>주소</th><td>${t(v.addr)}</td></tr>
    <tr><th>소속부서</th><td>${t(v.dept)}</td><th>근무장소</th><td>${t(co.name)} 사업장 소재지 및 업무상 필요한 일체의 장소</td></tr></table>
  <h3>제1조 [ 근로계약기간 ]</h3>
  <table class="dt"><tr><th>근로계약기간</th><td>${period}</td></tr></table>
  <p>① 기간의 정함이 있는 근로계약이 체결된 경우, 사용자가 근로자에게 계약기간 내에 서면 또는 구두로 계약의 종료를 통보한 때에는 제1항의 계약 만료일에 근로계약은 자동으로 종료한다.</p>
  <p>② 제2항에도 불구하고 근로자가 신규 입사자인 경우, 제1항의 계약 만료일이 경과되었음에도 불구하고 사용자의 이의 없이 근로자가 계속 근로한 때에는 제1항의 입사일로부터 1년이 되는 날까지 근로계약이 자동으로 연장된 것으로 본다.</p>
  <h3>제2조 [ 담당업무 및 근무장소 ]</h3>
  <table class="dt"><tr><th>담당업무</th><td>${t(v.job)} 및 관련된 일체의 부수업무</td></tr><tr><th>근무장소</th><td>사업장의 소재지 및 업무상 필요한 일체의 장소</td></tr></table>
  <h3>제3조 [ 소정근로일 및 근로시간과 휴게시간 ]</h3>
  <p>① 근로자의 소정근로일은 월요일부터 토요일 중 근무편성에 따라 1일을 휴무하는 주5일제 근무를 원칙으로 한다. 단, 근로자는 주중 공휴일이 있는 경우 그 날을 휴무일로 편성하고 나머지 날을 소정근로일로 편성할 수 있음에 동의한다.</p>
  <p>② 근로자의 근로일별 소정근로시간(업무준비시간을 포함한다) 및 휴게시간은 다음과 같다. 단, 근로자는 업무사정으로 토요일 휴게시간에 휴게하지 못한 경우에는 조기퇴근하는 방법으로 휴게시간을 갈음하는 것에 동의한다.<br>&nbsp;&nbsp;1. 평 일 : 09:00 ~ 18:30 (휴게시간 12:30 ~ 14:00)<br>&nbsp;&nbsp;2. 토요일 : 09:00 ~ 14:00 (휴게시간 13:00 ~ 13:30)</p>
  <p>③ 근로자의 월 단위 소정근로시간은 다음의 방식으로 계산한다.<br>&nbsp;&nbsp;1. 1주 소정 근로시간 : 8시간 * 5일 = 1주 40시간 (가장 장시간인 경우를 기준으로 산정한다)<br>&nbsp;&nbsp;2. 1월 소정 근로시간 : (주 40시간 + 주휴 8시간) * 4.345주 = 1월 약 209시간</p>
  <h3>제4조 [ 시간외근로 ]</h3>
  <p>① 근로자는 월요일 근무 시 20:30까지 2시간의 연장근로를 실시하는 것에 동의한다.</p>
  <p>② 사용자는 근로자에게 다음 각 호의 연장근로시간에 해당하는 제수당을 월 급여와 함께 지급한다.<br>&nbsp;&nbsp;1. 제1항에 따른 1주 2시간의 연장근로시간<br>&nbsp;&nbsp;2. 그 외 산정하기 곤란한 연장근로의 발생에 대비한 1주 평균 2.5시간의 연장근로시간<br>&nbsp;&nbsp;3. 1월 연장 근로시간 : 1주 4.5시간 * 4.345주 = 1월 약 19시간</p>
  <p>③ 근로자는 사용자의 업무상 필요가 있는 경우 노동관계법령이 허용하는 범위 내에서 제1항 및 제2항 외의 시간외근로(연장근로 및 휴일근로)를 실시하는 것에 동의하며, 이 경우 사용자는 근로자에게 별도의 시간외수당을 지급한다.</p>
  <p>④ 근로자는 사용자의 승인 또는 지시 없이 시간외근로를 실시하여서는 아니되며, 이를 위반하여 실시하는 경우 별도의 임금을 지급하지 아니한다.</p>
  <h3>제5조 [ 임금의 구성항목 및 지급방법 ]</h3>
  <table class="dt pay5"><colgroup><col style="width:20%"><col style="width:16%"><col style="width:64%"></colgroup><tr><th>항목</th><th>금액</th><th>산출 내역 및 지급 기준</th></tr>
    <tr><th>연봉총액</th><td class="r">${won2(v.annual)}</td><td>세전 연간 총 지급액 (퇴직금 별도)</td></tr>
    <tr><th>세전 월 급여액</th><td class="r">${won2(v.month)}</td><td>기본급 + 고정연장수당 + 식대 합계액</td></tr>
    <tr><th>기본급</th><td class="r">${won2(v.base)}</td><td>월 소정근로시간(209시간)에 대한 통상임금 기준 기본 대가</td></tr>
    <tr><th>고정연장수당</th><td class="r">${won2(v.ot)}</td><td></td></tr>
    <tr><th>식대</th><td class="r">${won2(v.meal)}</td><td>비과세 실비변상적 식사보조비 (월 200,000원 한도 비과세)</td></tr>
    <tr><th>지급일 및 방법</th><td colspan="2">매월 5일 (공휴일인 경우 그 전일 또는 익일 지급), 근로자 명의의 급여통장으로 계좌이체 직접 지급</td></tr></table>
  <p>① 근로자가 부담하는 제세공과금에 대한 연말정산금액은 환급 또는 징수여부와 관계없이 모두 근로자에게 귀속한다.</p>
  <p>② 근로자가 월 급여의 산정기간 도중 입퇴사한 경우 위의 세전 월 급여액을 해당 월의 총 일수로 나눈 후 재직일수를 곱하여 일할계산한다.</p>
  <p>③ 근로자가 월 급여의 산정기간 도중 지각, 조퇴한 경우에는 해당 시간분의 통상시급을 공제하며, 결근이 발생한 경우에는 해당 일의 임금 및 해당 주의 주휴수당을 공제한다.</p>
  <p>④ 근로자는 중도퇴사한 경우 임금 및 4대보험 정산 등 금품청산을 위하여 퇴사 월의 임금지급기일을 정기 급여일까지 연장하는 것에 동의한다.</p>
  <h3>제6조 [ 퇴직급여 및 기타수당 ]</h3>
  <p>① 사용자는 근로자가 1년 이상 계속근로한 후 퇴직하는 경우 근로자퇴직급여보장법에 따른 퇴직금 또는 퇴직급여를 지급한다.</p>
  <p>② 사용자는 근로자에게 그 재량에 따라 제5조의 임금 및 법정 제수당 외 인센티브 등 기타수당을 지급할 수 있다. 단, 기타수당을 지급하는 경우라 하더라도 사용자는 기타수당의 지급여부, 지급기준 등 일체의 사항에 대한 상시적인 개폐권을 보유하며, 근로자에 대한 지급의무를 부담하지 아니한다.</p>
  <h3>제7조 [ 휴일 및 휴가 ]</h3>
  <p>① 주휴일: 매주 일요일을 유급 주휴일로 정하며, 병원이 정한 주중 1일을 무급휴무일로 한다.</p>
  <p>② 법정휴일: 근로자의 날(5월 1일) 및 관공서 공휴일에 관한 규정에서 정한 공휴일(대체공휴일 포함)은 유급휴일로 처리한다.</p>
  <p>③ 연차유급휴가: 근로기준법 제60조가 정하는 바에 따라 산정 및 부여하며, 사전 서면 신청 후 진료에 지장이 없도록 사용한다.</p>
  <h3>제8조 [ 비밀유지 및 보안 의무 ]</h3>
  <p>① 근로자는 재직 중은 물론 퇴직 후에도 환자의 의료정보, 개인정보, 병원의 전산자료 및 영업비밀을 제3자에게 누설하지 아니한다.</p>
  <p>② 근로자는 본인의 임금(연봉, 기본급, 수당 등 일체) 내역을 타 직원 및 외부에 절대 누설하지 않으며, 위반 시 징계 조치를 감수한다.</p>
  <h3>제9조 [ 계약 해지 및 퇴직 절차 ]</h3>
  <p>① 근로자가 자진 퇴직하고자 하는 경우, 퇴직일 또는 계약기간 만료일로부터 적어도 30일 이전에 서면으로 사직서를 제출하여야 하며, 퇴직일 전까지 업무에 대한 자료와 정보를 후임자에게 성실히 인계하여야 한다.</p>
  <p>② 사용자는 근로자에게 다음 각 호의 사유가 발생한 경우 근로계약을 해지할 수 있다.<br>&nbsp;&nbsp;1. 음주 후 출근하거나 근무 중 음주하였을 경우<br>&nbsp;&nbsp;2. 정당한 이유 없이 3일 이상 무단결근을 하거나 경위서를 1개월간 3회 이상 제출할 경우<br>&nbsp;&nbsp;3. 업무를 게을리하거나 업무수행 능력이 부족한 경우<br>&nbsp;&nbsp;4. 상사의 정당한 지시에 따르지 아니한 경우<br>&nbsp;&nbsp;5. 근로자의 귀책 사유로 사용자에게 사업상 중대한 지장을 초래하거나 재산상 손실이 발생한 경우<br>&nbsp;&nbsp;6. 지각을 반복하여 업무에 지장을 준 경우 (1개월간 5회 이상)<br>&nbsp;&nbsp;7. 풍기문란으로 직장규율을 위반하였을 경우<br>&nbsp;&nbsp;8. 불친절로 제기된 고객의 항의가 1개월간 3회 이상일 경우<br>&nbsp;&nbsp;9. 기타 전 각 호에 준하는 사유가 발생한 경우</p>
  <p>③ 근로자가 개인사정으로 입사일로부터 3개월 이내에 퇴사하는 경우 의복비를 반환하여야 한다.</p>
  <p>④ 본 계약서에 명시되지 않은 사항은 근로기준법, 노동관계법령 및 병원의 취업규칙(사규)에서 정하는 바에 따른다.</p>
  <h3>제10조 [ 기타사항 ]</h3>
  <p>① 근로자는 고의 또는 중대한 과실로 인하여 사용자에게 손해를 입힌 경우에는 책임있는 범위 내에서 그 실손해에 대한 책임을 진다.</p>
  <p>② 근로자는 본 근로계약 및 사용자의 취업규칙에 따라 성실히 근무하여야 하며, 사용자는 근로자의 근무태도, 업무능력, 질서문란 등에 대하여 취업규칙에 따라 적절한 조치를 취할 수 있다.</p>
  <p>③ 본 근로계약에 명시되지 아니한 사항은 취업규칙, 노동관계법령에 따른다.</p>
  <p class="center gap">본 계약 체결을 증명하기 위하여 계약서 2부를 작성하고, 사업주와 근로자가 서명 또는 날인 후 각 1부씩 보관한다.</p>
  <p class="center date">${krDate(v.date).replace(/ /g, '  ')}</p>
  <div class="signs">
    <table class="dt"><tr><th colspan="2" class="center">[ 사 업 주 (사용자) ]</th></tr>
      <tr><th>사업체명</th><td>${t(co.name)}</td></tr><tr><th>사업자번호</th><td>${t(co.bizNo)}</td></tr>
      <tr><th>소재지</th><td>${t(co.addr)}</td></tr><tr><th>대표자</th><td>${t(co.ceo)}&nbsp;&nbsp;(직인/서명)</td></tr></table>
    <table class="dt"><tr><th colspan="2" class="center">[ 근 로 자 ]</th></tr>
      <tr><th>주소</th><td>${t(v.addr)}</td></tr><tr><th>주민등록번호</th><td>${t(v.rrn)}</td></tr>
      <tr><th>연락처</th><td>${t(telFmt(v.phone))}</td></tr><tr><th>성명</th><td>${t(v.name)}&nbsp;&nbsp;(서명 또는 인)</td></tr></table>
  </div></div>`;
}

function certHtml(v, co) {
  const t = (s) => esc(s || '');
  const quit = v.status === '퇴사';
  return `<div class="paper cert">
  <h2>재&nbsp;&nbsp;직&nbsp;&nbsp;증&nbsp;&nbsp;명&nbsp;&nbsp;서</h2>
  <h3>[ 1. 인적사항 ]</h3>
  <table class="dt fx"><colgroup><col style="width:18%"><col style="width:32%"><col style="width:18%"><col style="width:32%"></colgroup><tr><th>성명</th><td>${t(v.name)}</td><th>주민등록번호</th><td>${t(v.rrn)}</td></tr>
    <tr><th>주소</th><td colspan="3">${t(v.addr)}</td></tr></table>
  <h3>[ 2. 재직사항 ]</h3>
  <table class="dt fx"><colgroup><col style="width:18%"><col style="width:32%"><col style="width:18%"><col style="width:32%"></colgroup><tr><th>회사명</th><td>${t(co.name)}</td><th>대표자</th><td>대표원장 ${t(co.ceo)}</td></tr>
    <tr><th>사업자등록번호</th><td>${t(co.bizNo)}</td><th>업태 / 종목</th><td>${t(co.bizType)}</td></tr>
    <tr><th>소재지</th><td colspan="3">${t(co.addr)}</td></tr>
    <tr><th>직위 및 담당업무</th><td>${t(v.job)}</td><th>소속부서</th><td>${t(v.dept)}</td></tr>
    <tr><th>입사일자</th><td>${krDate(v.start)}</td><th>재직구분</th><td>${quit ? '퇴사' : '재직중'}</td></tr>
    <tr><th>재직기간</th><td colspan="3">${krDate(v.start)} ~ ${quit ? krDate(v.end) : '현재 (재직중)'}</td></tr></table>
  <h3>[ 3. 증명서 용도 ]</h3>
  <table class="dt fx"><colgroup><col style="width:18%"><col style="width:82%"></colgroup><tr><th>용도</th><td>${t(v.purpose)}</td></tr></table>
  <p class="center stmt">상기인은 위와 같이 ${quit ? '재직하였음' : '현재 재직 중임'}을 증명합니다.</p>
  <p class="center date">${krDate(v.date).replace(/ /g, '   ')}</p>
  <p class="center seal">${t(co.name).split('').join(' ')}&nbsp;&nbsp;&nbsp;대 표 원 장&nbsp;&nbsp;&nbsp;&nbsp;${t(co.ceo).split('').join('&nbsp;&nbsp;&nbsp;')}&nbsp;&nbsp;&nbsp;(인)</p>
  ${co.tel || co.fax ? `<p class="center tel">${co.tel ? 'TEL : ' + t(co.tel) : ''}&nbsp;&nbsp;&nbsp;&nbsp;${co.fax ? 'FAX : ' + t(co.fax) : ''}</p>` : ''}
  </div>`;
}

async function renderDocs() {
  const kind = sub?.kind || 'contract';
  const [people, coSnap, org, reqs] = await Promise.all([loadPeople(), getDoc(doc(db, 'settings', 'company')), loadOrg(), docReqPanel()]);
  const req = sub?.req ? reqs.find((r) => r.id === sub.req) : null;
  const co = coSnap.exists() ? coSnap.data() : {};
  const order = orgOrder(org);
  const rankOf = (n) => { const i = order.findIndex((o) => o.name === n); return i < 0 ? 999 : i; };
  const list = people.filter((p) => ['active', 'roster'].includes(p.status))
    .sort((a, b) => ((a.work === '퇴사') - (b.work === '퇴사')) || rankOf(a.name) - rankOf(b.name) || a.name.localeCompare(b.name, 'ko'));
  const uid = sub?.uid || list[0]?.uid;
  const p = list.find((x) => x.uid === uid) || {};
  let sal = {};
  if (p.uid) { const s = await getDoc(doc(db, 'salaries', p.uid)); sal = s.exists() ? s.data() : {}; }
  const sp = paySplit(num(sal.annual));
  const v = kind === 'contract'
    ? { name: p.name, rrn: sal.rrn, phone: p.phone, addr: sal.address, dept: p.dept || p.team, job: p.job, start: sal.contractStart || p.hireDate, end: sal.contractEnd,
      annual: num(sal.annual) || '', month: sp.month || '', base: sp.base || '', ot: sp.ot || '', meal: sp.meal, date: today() }
    : { name: p.name, rrn: sal.rrn, addr: sal.address, dept: p.dept || p.team, job: p.job, start: p.hireDate, status: p.work === '퇴사' ? '퇴사' : '재직중', end: p.leaveDate || '', purpose: req?.purpose || '재직 확인용', date: today() };
  const F = kind === 'contract'
    ? [['name', '성명'], ['rrn', '주민등록번호'], ['phone', '연락처'], ['addr', '주소'], ['dept', '소속부서'], ['job', '담당업무'], ['start', '계약 시작일', 'date'], ['end', '계약 만료일 (없으면 비워 두기)', 'date'],
      ['annual', '연봉총액', 'money'], ['month', '세전 월 급여액', 'money'], ['base', '기본급', 'money'], ['ot', '고정연장수당', 'money'], ['meal', '식대', 'money'], ['date', '작성일', 'date']]
    : [['name', '성명'], ['rrn', '주민등록번호'], ['addr', '주소'], ['job', '직위 및 담당업무'], ['dept', '소속부서'], ['start', '입사일자', 'date'], ['status', '재직구분', 'status'], ['end', '퇴사일 (퇴사자만)', 'date'], ['purpose', '용도'], ['date', '발급일', 'date']];
  const missing = F.filter(([k]) => ['name', 'rrn', 'addr', 'job', 'start'].includes(k) && !v[k]).map(([, l]) => l);
  const coMissing = !co.name || !co.ceo || !co.bizNo || !co.addr;
  shell(`
    <div class="row between"><div><p class="eyebrow">DOCUMENTS</p><h1>서류 발급</h1></div>
      <button class="primary" id="print">🖨️ 인쇄 / PDF 저장</button></div>
    ${reqs.length ? `<section class="card reqBox"><h3>📨 직원 서류 신청 ${reqs.length}건</h3>
      ${reqs.map((r) => `<div class="reqRow ${req?.id === r.id ? 'cur' : ''}"><div><b>${esc(r.name)}</b> · ${esc(r.type)} <span class="sm">· 용도: ${esc(r.purpose)}${r.copies > 1 ? ` · ${r.copies}부` : ''}${r.needDate ? ` · 필요일 ${esc(r.needDate)}` : ''}</span>${r.note ? `<br><span class="sm cite2">요청: ${esc(r.note)}</span>` : ''}<br><span class="muted sm">${esc(r.date)} 신청</span></div>
        <div class="row"><button class="primary sm" data-open="${r.id}">🖨️ 서류 열기</button><button class="sm" data-done="${r.id}">✅ 발급 완료</button><button class="ghost sm" data-rej="${r.id}">반려</button></div></div>`).join('')}
    </section>` : ''}
    ${req ? `<p class="reqNow">📨 <b>${esc(req.name)}</b>님이 신청한 재직증명서예요. 인쇄한 뒤 위의 <b>✅ 발급 완료</b>를 눌러 주세요.</p>` : ''}
    <div class="chips"><button data-kind="contract" class="${kind === 'contract' ? 'on' : ''}">📄 근로계약서</button><button data-kind="cert" class="${kind === 'cert' ? 'on' : ''}">📃 재직증명서</button></div>
    <div class="docGrid">
      <div>
        <section class="card form">
          <label>직원 선택<select id="who">${list.map((x) => `<option value="${x.uid}" ${x.uid === uid ? 'selected' : ''}>${esc(x.name)}${x.job ? ' · ' + esc(x.job) : ''}${x.work === '퇴사' ? ' (퇴사)' : ''}</option>`).join('')}</select></label>
          ${missing.length ? `<p class="warnTxt">⚠️ 직원 명부에 비어 있는 항목: ${missing.join(', ')}. 아래 칸에 직접 쓰거나 <a href="#" id="toPerson">직원 명부</a>에서 채워 주세요.</p>` : '<p class="muted sm">직원 명부 내용이 자동으로 채워졌어요. 이 서류에만 바꿀 내용은 아래 칸에서 고치세요.</p>'}
          ${F.map(([k, l, ty]) => ty === 'status'
            ? `<label>${l}<select data-f="${k}"><option ${v[k] !== '퇴사' ? 'selected' : ''}>재직중</option><option ${v[k] === '퇴사' ? 'selected' : ''}>퇴사</option></select></label>`
            : `<label>${l}<input data-f="${k}" ${ty === 'date' ? 'type="date"' : ty === 'money' ? 'inputmode="numeric"' : ''} value="${esc(ty === 'money' ? (v[k] === '' ? '' : comma(v[k])) : v[k] ?? '')}"></label>`).join('')}
          ${kind === 'contract' ? '<p class="muted sm">연봉을 바꾸면 월 급여·기본급·고정연장수당이 다시 계산돼요. (월급에서 식대를 뺀 금액의 80%가 기본급)</p>' : ''}
        </section>
        <details class="card" ${coMissing ? 'open' : ''}><summary><b>🏥 사업장 정보</b> ${coMissing ? '<span class="warnTxt">— 먼저 채워 주세요</span>' : '<span class="muted sm">(모든 서류에 공통)</span>'}</summary>
          <div class="form">${COMPANY_FIELDS.map(([k, l, ph]) => `<label>${l}<input data-co="${k}" value="${esc(co[k] || '')}" placeholder="${ph}"></label>`).join('')}
          <button class="primary sm" id="coSave">사업장 정보 저장</button></div></details>
      </div>
      <div class="paperWrap" id="paper"></div>
    </div>`);
  const cur = { ...v }, coCur = { ...co };
  const draw = () => { document.getElementById('paper').innerHTML = kind === 'contract' ? contractHtml(cur, coCur) : certHtml(cur, coCur); };
  draw();
  $app.querySelectorAll('[data-kind]').forEach((b) => b.onclick = () => go('docs', { kind: b.dataset.kind, uid }));
  document.getElementById('who').onchange = (e) => go('docs', { kind, uid: e.target.value });
  $app.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => { const r = reqs.find((x) => x.id === b.dataset.open); go('docs', { kind: 'cert', uid: r.uid, req: r.id }); });
  $app.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => {
    await updateDoc(doc(db, 'docReqs', b.dataset.done), { status: '발급완료', doneBy: me.name, doneDate: today() });
    toast('발급 완료로 표시했어요. 직원 화면에도 보여요'); go('docs', { kind, uid });
  });
  $app.querySelectorAll('[data-rej]').forEach((b) => b.onclick = async () => {
    const why = prompt('반려 이유를 적어 주세요 (직원에게 보여요)', ''); if (why === null) return;
    await updateDoc(doc(db, 'docReqs', b.dataset.rej), { status: '반려', reply: why, doneBy: me.name, doneDate: today() });
    toast('반려했어요'); go('docs', { kind, uid });
  });
  document.getElementById('toPerson')?.addEventListener('click', (e) => { e.preventDefault(); go('hr', { uid }); });
  $app.querySelectorAll('[data-f]').forEach((el) => el.oninput = el.onchange = () => {
    const k = el.dataset.f;
    const money = ['annual', 'month', 'base', 'ot', 'meal'].includes(k);
    cur[k] = money ? (el.value.trim() === '' ? '' : num(el.value)) : el.value;
    if (k === 'annual' || k === 'meal') {
      const s = paySplit(num(cur.annual), num(cur.meal));
      Object.assign(cur, { month: s.month || '', base: s.base || '', ot: s.ot || '' });
      ['month', 'base', 'ot'].forEach((x) => { const i = $app.querySelector(`[data-f="${x}"]`); if (i) i.value = cur[x] === '' ? '' : comma(cur[x]); });
    }
    draw();
  });
  $app.querySelectorAll('[data-f]').forEach((el) => { if (['annual', 'month', 'base', 'ot', 'meal'].includes(el.dataset.f)) el.onblur = () => { el.value = el.value.trim() === '' ? '' : comma(num(el.value)); }; });
  $app.querySelectorAll('[data-co]').forEach((el) => el.oninput = () => { coCur[el.dataset.co] = el.value; draw(); });
  document.getElementById('coSave').onclick = async () => {
    await setDoc(doc(db, 'settings', 'company'), coCur); toast('사업장 정보를 저장했어요');
  };
  document.getElementById('print').onclick = () => {
    const w = document.createElement('div'); w.className = 'modal printable docPrint';
    w.innerHTML = `<div class="modalBox">${document.getElementById('paper').innerHTML}</div>`;
    document.body.appendChild(w);
    const prevTitle = document.title;
    document.title = `${kind === 'contract' ? '근로계약서' : '재직증명서'}_${cur.name || ''}_${today()}`;
    document.body.classList.add('printModal'); window.print(); document.body.classList.remove('printModal');
    document.title = prevTitle; w.remove();
  };
}


// ---------- 서류 신청 (직원 → 관리자 확인 후 출력) ----------
// docReqs/{id}: {uid, name, type, purpose, needDate, note, status:'신청'|'발급완료'|'반려', date, at, doneBy, doneDate, reply}
let docPending = 0;
async function countDocPending() {
  if (me?.role !== 'admin') { docPending = 0; return; }
  try { docPending = (await getDocs(query(collection(db, 'docReqs'), where('status', '==', '신청')))).size; } catch (e) { docPending = 0; }
}
const DOC_TYPES = ['재직증명서'];
const reqStCls = { '신청': 'st-ing', '발급완료': 'st-ok', '반려': 'st-hold' };

async function renderDocReq() {
  const s = await getDocs(query(collection(db, 'docReqs'), where('uid', '==', me.uid)));
  const mine = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  shell(`
    <h1>📨 서류 신청</h1>
    <p class="muted">신청하면 관리자가 확인한 뒤 발급해 드려요.</p>
    <section class="card form">
      <label>서류 종류<select id="dt">${DOC_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label>용도 <small class="muted">(예: 대출 심사 제출용, 어린이집 제출용)</small><input id="dp" placeholder="어디에 낼 서류인지 적어 주세요"></label>
      <div class="two"><label>필요한 날짜 (선택)<input id="dd" type="date"></label><label>부수<select id="dc">${[1, 2, 3].map((n) => `<option>${n}</option>`).join('')}</select></label></div>
      <label>요청 사항 (선택)<input id="dn" placeholder="예: 주민등록번호 뒷자리 가려 주세요"></label>
      <button class="primary" id="dsend">신청하기</button>
    </section>
    <section class="card"><h3>내 신청 내역</h3>
      ${mine.map((r) => `<div class="reqRow">
        <div><b>${esc(r.type)}</b> <span class="stTag ${reqStCls[r.status] || ''}">${esc(r.status)}</span><br>
          <span class="sm">용도: ${esc(r.purpose)}${r.copies > 1 ? ` · ${r.copies}부` : ''}${r.needDate ? ` · 필요일 ${esc(r.needDate)}` : ''}</span>
          ${r.reply ? `<br><span class="sm cite2">답변: ${esc(r.reply)}</span>` : ''}</div>
        <div class="right sm muted">${esc(r.date)} 신청${r.doneDate ? `<br>${esc(r.doneDate)} ${r.status === '반려' ? '반려' : '발급'}` : ''}
          ${r.status === '신청' ? `<br><button class="ghost sm" data-cancel="${r.id}">신청 취소</button>` : ''}</div></div>`).join('') || '<p class="muted">아직 신청한 서류가 없어요.</p>'}
    </section>`);
  document.getElementById('dsend').onclick = async () => {
    const purpose = val('dp'); if (!purpose) return toast('용도를 적어 주세요');
    await addDoc(collection(db, 'docReqs'), { uid: me.uid, name: me.name, type: val('dt'), purpose, needDate: val('dd'), copies: Number(val('dc')) || 1, note: val('dn'), status: '신청', date: today(), at: serverTimestamp() });
    toast('신청했어요. 관리자가 확인 후 발급해 드려요'); renderDocReq();
  };
  $app.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => {
    if (!confirm('신청을 취소할까요?')) return;
    await deleteDoc(doc(db, 'docReqs', b.dataset.cancel)); toast('취소했어요'); renderDocReq();
  });
}
async function docReqPanel() {
  const s = await getDocs(query(collection(db, 'docReqs'), where('status', '==', '신청')));
  const list = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  docPending = list.length;
  return list;
}

// 기존 직원명부(구글 시트 → 엑셀로 내려받기)에서 주민등록번호·주소·계약기간·연봉 등 채우기
async function importRosterExcel(file, people) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const norm = (s) => String(s ?? '').replace(/\s+/g, '');
  let rows = null, h = -1;
  for (const n of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });
    const i = r.findIndex((row) => row.some((c) => norm(c) === '성명') && row.some((c) => norm(c) === '주민등록번호'));
    if (i >= 0) { rows = r; h = i; break; }
  }
  if (!rows) throw new Error('"성명"과 "주민등록번호" 머리글이 있는 시트를 찾지 못했어요.');
  const head = rows[h].map(norm);
  const col = (...names) => head.findIndex((c) => names.some((n) => c === n || c.startsWith(n)));
  const C = { name: col('성명'), rrn: col('주민등록번호'), phone: col('연락처'), addr: col('주소'), dept: col('소속부서', '부서'), job: col('직위/담당업무', '직위', '담당업무'),
    hire: col('입사일자', '입사일'), cs: col('계약시작일'), ce: col('계약만료일'), annual: col('연봉총액', '연봉') };
  const dateOf = (s) => { const m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m && m[1] > '1900' ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : ''; };
  const get = (r, k) => (C[k] >= 0 ? String(r[C[k]] ?? '').trim() : '');
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const name = get(r, 'name'); if (!name) continue;
    const email = r.map((c) => String(c)).find((c) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(c.trim())) || '';
    const p = people.find((x) => x.name === name && x.status !== 'rejected');
    out.push({ name, p, rrn: get(r, 'rrn'), phone: get(r, 'phone'), addr: get(r, 'addr'), dept: get(r, 'dept'), job: get(r, 'job'),
      hire: dateOf(get(r, 'hire')), cs: dateOf(get(r, 'cs')), ce: dateOf(get(r, 'ce')), annual: num(get(r, 'annual')), email: email.trim() });
  }
  return out;
}
async function applyRosterRows(rows) {
  let n = 0;
  for (const x of rows.filter((y) => y.p)) {
    const p = x.p;
    const s = await getDoc(doc(db, 'salaries', p.uid)); const sal = s.exists() ? s.data() : {};
    const next = { ...sal, updatedAt: serverTimestamp() };
    if (x.rrn) next.rrn = x.rrn;
    if (x.addr) next.address = x.addr;
    if (x.cs) next.contractStart = x.cs;
    next.contractEnd = x.ce || sal.contractEnd || '';
    if (x.annual && !num(sal.annual)) {
      Object.assign(next, { annual: x.annual, monthly: Math.round(x.annual / 12), annualDate: today(), annualBy: me.name + ' (명부 가져오기)' });
      next.history = [...(sal.history || []), { annual: x.annual, date: today(), by: me.name }];
    }
    await setDoc(doc(db, 'salaries', p.uid), next);
    const u = {};
    if (x.phone && !p.phone) u.phone = x.phone;
    if (x.dept && !p.dept) u.dept = x.dept;
    if (x.job && !p.job) u.job = x.job;
    if (x.hire && !p.hireDate) u.hireDate = x.hire;
    if (x.email && !p.email && p.status === 'roster') u.email = x.email;
    if (Object.keys(u).length) await updateDoc(doc(db, 'users', p.uid), u);
    n++;
  }
  return n;
}

// ---------- 원내매뉴얼 ----------
// manuals/{id}: 페이지 {title, group, sub, code, order, body(HTML), updatedAt, updatedBy}  (_home, _check 은 특별 페이지)
// manualMeta/tree: {groups:[{name}]} · manualImages/{id}: {data} · manualLog: 업데이트 기록/AI 제안
// notes: 직원 성찰노트 · manualReqs: 개선 요청
let mcache = null;            // { pages:{id:page}, tree, pending }
const mimg = {};              // 이미지 캐시 id → dataURL
const MTABS = { check: '진료 준비 체크리스트', notes: '직원 성찰노트', log: '매뉴얼 업데이트 리뷰', req: '개선 요청', admin: '목차·가져오기' };
const REQ_ST = ['접수', '검토 중', '반영', '보류'];
const today = () => ymd(new Date());
const dstr = (t) => t?.toDate ? ymd(t.toDate()) : (t || '');

async function loadManual(force = false) {
  if (mcache && !force) return mcache;
  const [ps, tr] = await Promise.all([getDocs(collection(db, 'manuals')), getDoc(doc(db, 'manualMeta', 'tree'))]);
  const pages = {};
  ps.docs.forEach((d) => {
    const p = { id: d.id, ...d.data() };
    if (p.body === undefined) p.body = '';
    if (!p.html && !/<[a-z][\s\S]*>/i.test(p.body)) p.body = `<p>${esc(p.body).replace(/\n/g, '<br>')}</p>`;   // 예전 글
    if (!p.group && !p.id.startsWith('_')) p.group = '기타';
    pages[p.id] = p;
  });
  let pending = 0;
  if (can.editManual()) {
    try { pending = (await getDocs(query(collection(db, 'manualLog'), where('status', '==', 'pending')))).size; } catch (e) { /* 없음 */ }
  }
  const tree = tr.exists() ? tr.data() : { groups: [] };
  // 트리에 없는 그룹도 보이게
  const names = tree.groups.map((g) => g.name);
  Object.values(pages).forEach((p) => { if (p.group && !names.includes(p.group)) { names.push(p.group); tree.groups.push({ name: p.group }); } });
  mcache = { pages, tree, pending };
  return mcache;
}
const mPages = () => Object.values(mcache?.pages || {}).filter((p) => !p.id.startsWith('_'));
const mSort = (a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.title.localeCompare(b.title);
const plainText = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.replace(/\s+/g, ' ').trim(); };

// 좌측 목차 (그룹은 열고 닫기)
function manualSide(key) {
  const c = mcache;
  if (!c) return '';
  let open = {};
  try { open = JSON.parse(localStorage.getItem('mOpen') || '{}'); } catch (e) { /* 무시 */ }
  const curId = key.startsWith('mp:') ? key.slice(3) : null;
  const curG = curId && c.pages[curId]?.group;
  const groups = c.tree.groups.map((g) => {
    const ps = mPages().filter((p) => p.group === g.name).sort(mSort);
    if (!ps.length && !can.editManual()) return '';
    // 작은 제목(sub)별로 한 번 더 열고 닫기
    const runs = [];
    ps.forEach((p) => { const sname = p.sub || ''; const last = runs[runs.length - 1]; if (last && last.sub === sname) last.ps.push(p); else runs.push({ sub: sname, ps: [p] }); });
    const pbtn = (p, cls = '') => `<button data-k="mp:${p.id}" class="mi ${cls} ${curId === p.id ? 'on' : ''}">${esc(p.title)}</button>`;
    const items = runs.map((r) => {
      if (!r.sub) return r.ps.map((p) => pbtn(p)).join('');
      const k = g.name + '/' + r.sub;
      const sOpen = open[k] || r.ps.some((p) => p.id === curId);
      return `<details class="msubg" data-g="${esc(k)}" ${sOpen ? 'open' : ''}><summary>${esc(r.sub)} <small>${r.ps.length}</small></summary>${r.ps.map((p) => pbtn(p, 'deep')).join('')}</details>`;
    }).join('');
    const isOpen = open[g.name] || curG === g.name;
    return `<details class="mgrp" data-g="${esc(g.name)}" ${isOpen ? 'open' : ''}><summary>${esc(g.name)} <small>${ps.length}</small></summary>${items || '<p class="muted sm">페이지 없음</p>'}</details>`;
  }).join('');
  return `<div class="mtree"><details class="mtreeWrap" open><summary class="mtreeHead">📚 매뉴얼 목차</summary>
    <input class="msearch" id="msearch" placeholder="🔍 매뉴얼 검색">
    <div id="mresult"></div><div id="mgroups">${groups}</div></details></div>`;
}
function bindManualSide() {
  document.querySelectorAll('details.mgrp, details.msubg').forEach((d) => d.addEventListener('toggle', () => {
    let o = {}; try { o = JSON.parse(localStorage.getItem('mOpen') || '{}'); } catch (e) { /* 무시 */ }
    o[d.dataset.g] = d.open; localStorage.setItem('mOpen', JSON.stringify(o));
  }));
  const s = document.getElementById('msearch');
  if (!s) return;
  if (window.innerWidth <= 760) document.querySelector('.mtreeWrap')?.removeAttribute('open');
  s.oninput = () => {
    const q = s.value.trim().toLowerCase();
    const box = document.getElementById('mresult'), gs = document.getElementById('mgroups');
    if (!q) { box.innerHTML = ''; gs.style.display = ''; return; }
    gs.style.display = 'none';
    const hits = mPages().filter((p) => (p.title + ' ' + (p._text ??= plainText(p.body))).toLowerCase().includes(q)).sort(mSort);
    box.innerHTML = hits.map((p) => {
      const t = p._text, i = t.toLowerCase().indexOf(q);
      const snip = i >= 0 ? '…' + esc(t.slice(Math.max(0, i - 15), i + 30)) + '…' : '';
      return `<button data-k="mp:${p.id}" class="mi"><b>${esc(p.title)}</b><small class="muted">${snip}</small></button>`;
    }).join('') || '<p class="muted sm">검색 결과가 없어요.</p>';
    box.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => goKey(b.dataset.k));
  };
}

// 본문 안전하게 + 사진 불러오기 + 체크리스트
function cleanHtml(html) {
  const d = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  d.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((x) => x.remove());
  d.querySelectorAll('*').forEach((el) => [...el.attributes].forEach((a) => {
    if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
  }));
  return d.body.firstChild.innerHTML;
}
async function hydrateImages(root) {
  for (const img of root.querySelectorAll('img[data-img]')) {
    const id = img.dataset.img;
    if (!mimg[id]) {
      try { const d = await getDoc(doc(db, 'manualImages', id)); if (d.exists()) mimg[id] = d.data().data; } catch (e) { /* 무시 */ }
    }
    if (mimg[id]) img.src = mimg[id];
  }
}
function bindChecks(root, pid) {
  const key = `chk:${pid}:${today()}`;
  let on = []; try { on = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { /* 무시 */ }
  const lis = [...root.querySelectorAll('ul.check > li')];
  lis.forEach((li, i) => {
    if (on.includes(i)) li.classList.add('on');
    li.onclick = (e) => {
      if (e.target.closest('a')) return;
      li.classList.toggle('on');
      const now = lis.map((x, j) => x.classList.contains('on') ? j : -1).filter((j) => j >= 0);
      localStorage.setItem(key, JSON.stringify(now));
      const p = root.querySelector('.chkProg'); if (p) p.textContent = `${now.length} / ${lis.length} 완료`;
    };
  });
  return lis.length;
}

async function renderManual() {
  await loadManual();
  if (sub?.edit !== undefined) return renderManualEdit(sub.edit);
  if (sub?.id) return renderManualPage(sub.id);
  const t = sub?.tab;
  if (t === 'check') return renderManualPage('_check');
  if (t === 'notes') return renderNotes();
  if (t === 'log') return renderMLog();
  if (t === 'req') return renderReqs();
  if (t === 'admin' && can.editManual()) return renderMAdmin();
  return renderManualPage('_home');
}

async function renderManualPage(id) {
  const p = mcache.pages[id];
  const special = id.startsWith('_');
  if (!p) {
    shell(`<h1>${id === '_home' ? '원내매뉴얼' : MTABS.check}</h1>
      <section class="card"><p>아직 내용이 없어요.</p>
      ${can.editManual() ? `<p class="muted sm">관리자 메뉴의 <b>목차·가져오기</b>에서 매뉴얼 파일을 가져오거나, 아래 버튼으로 직접 쓸 수 있어요.</p><button class="primary" id="mk">✏️ 직접 쓰기</button>` : ''}</section>`);
    document.getElementById('mk')?.addEventListener('click', () => go('manual', { edit: id }));
    return;
  }
  const crumb = special ? '원내매뉴얼' : `원내매뉴얼 / ${esc(p.group)}${p.sub ? ' / ' + esc(p.sub) : ''}`;
  shell(`
    <div class="crumb">${crumb}</div>
    <div class="row between mhead"><h1>${esc(p.title)}${p.code ? ` <small class="code">${esc(p.code)}</small>` : ''}</h1>
      ${can.editManual() ? '<button id="edit">✏️ 편집</button>' : ''}</div>
    <p class="muted sm">${p.updatedAt ? '최종 수정 ' + dstr(p.updatedAt) : ''}${p.updatedBy ? ' · ' + esc(p.updatedBy) : ''}<span class="chkProg"></span></p>
    <article class="mdoc" id="mdoc">${cleanHtml(p.body)}</article>
    ${special ? '' : `<div class="row mfoot"><button id="note">📝 이 매뉴얼로 성찰노트 쓰기</button><button id="req" class="ghost">💬 개선 요청하기</button></div>
    <section class="card"><h3>🔄 이 페이지 업데이트 기록</h3><div id="plog" class="muted sm">불러오는 중…</div></section>`}`);
  const root = document.getElementById('mdoc');
  const n = bindChecks(root, id);
  if (n) { const pr = document.querySelector('.chkProg'); pr.textContent = ` · 체크 ${root.querySelectorAll('ul.check > li.on').length} / ${n} 완료`; root.classList.add('hasChk'); }
  hydrateImages(root);
  document.getElementById('edit')?.addEventListener('click', () => go('manual', { edit: id }));
  document.getElementById('note')?.addEventListener('click', () => go('manual', { tab: 'notes', write: id }));
  document.getElementById('req')?.addEventListener('click', () => go('manual', { tab: 'req', write: id }));
  if (!special) {
    const logs = await getMLogs();
    const mine = logs.filter((l) => l.pageId === id && l.status === 'applied');
    document.getElementById('plog').innerHTML = mine.map((l) => `<div class="logRow"><b>${dstr(l.at)}</b> ${esc(l.summary)}${l.basis ? ` <span class="cite2">(근거: ${esc(l.basis)})</span>` : ''} <span class="muted">· ${esc(l.by || '')}</span></div>`).join('') || '아직 기록이 없어요.';
  }
}

// ---------- 편집기 ----------
const EFONTS = [['', '글꼴'], ...Object.values(FONTS).map((f) => [f.family, f.label]), ['"Nanum Myeongjo", serif', '명조']];
function editorToolbar() {
  return `<div class="etb" id="etb">
    <select data-cmd="formatBlock" title="문단"><option value="">문단</option><option value="p">본문</option><option value="h2">큰 제목</option><option value="h3">작은 제목</option></select>
    <select data-cmd="fontName" title="글꼴">${EFONTS.map(([v, l]) => `<option value='${v}'>${l}</option>`).join('')}</select>
    <select data-cmd="fontSize" title="글자 크기"><option value="">크기</option><option value="2">작게</option><option value="3">보통</option><option value="4">크게</option><option value="5">아주 크게</option></select>
    <span class="sep"></span>
    <button data-cmd="bold" title="굵게"><b>B</b></button><button data-cmd="italic" title="기울임"><i>I</i></button><button data-cmd="underline" title="밑줄"><u>U</u></button><button data-cmd="strikeThrough" title="취소선"><s>S</s></button>
    <label class="cpick" title="글자색">가<input type="color" data-cmd="foreColor" value="#c0392b"></label>
    <label class="cpick bg" title="배경색">배경<input type="color" data-cmd="hiliteColor" value="#fff3a3"></label>
    <span class="sep"></span>
    <button data-cmd="insertUnorderedList" title="글머리 목록">• 목록</button><button data-cmd="insertOrderedList" title="번호 목록">1. 목록</button>
    <button data-x="check" title="체크리스트">☑ 체크</button><button data-x="step" title="번호 단계">① 단계</button>
    <span class="sep"></span>
    <button data-x="box:info" class="bx info" title="파란 상자: 핵심">파란 상자</button><button data-x="box:tip" class="bx tip" title="초록 상자: 실습">초록 상자</button><button data-x="box:warn" class="bx warn" title="노란 상자: 원장님 확인 전">⚠️ 확인 필요</button><button data-x="unbox" title="상자 없애기">상자 빼기</button>
    <button data-x="cite" title="괄호로 근거·날짜 표시">(근거)</button>
    <span class="sep"></span>
    <label class="upload sm" title="사진 넣기">🖼️ 사진<input type="file" accept="image/*" id="eimg" hidden></label>
    <select data-x="imgsize" title="선택한 사진 크기"><option value="">사진 크기</option><option value="30%">작게</option><option value="55%">중간</option><option value="100%">크게</option></select>
    <button data-x="table" title="표 넣기">표</button><button data-x="hr" title="구분선">구분선</button>
    <span class="sep"></span>
    <button data-cmd="removeFormat" title="서식 지우기">서식 지우기</button><button data-cmd="undo" title="되돌리기">↶</button><button data-cmd="redo" title="다시">↷</button>
  </div>`;
}
function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let max = 1400, q = 0.82, out = '';
      do {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL('image/jpeg', q); max *= 0.8; q -= 0.06;
      } while (out.length > 700000 && max > 300);
      resolve(out);
    };
    img.src = URL.createObjectURL(file);
  });
}
function bindEditor(ed, newImgs) {
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('defaultParagraphSeparator', false, 'p');
  let lastImg = null, range = null;
  const keep = () => { const s = getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); };
  const restore = () => { ed.focus(); if (range) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); } };
  ed.addEventListener('keyup', keep); ed.addEventListener('mouseup', keep);
  ed.addEventListener('click', (e) => {
    ed.querySelectorAll('img.sel').forEach((x) => x.classList.remove('sel'));
    if (e.target.tagName === 'IMG') { lastImg = e.target; lastImg.classList.add('sel'); }
  });
  const blockOf = (n) => { while (n && n !== ed && !(n.nodeType === 1 && /^(P|H2|H3|H4|UL|OL|DIV|TABLE|FIGURE|BLOCKQUOTE)$/.test(n.tagName) && n.parentNode === ed || (n.parentNode?.classList?.contains('box') && n.nodeType === 1))) n = n.parentNode; return n === ed ? null : n; };
  const topBlock = (n) => { while (n && n.parentNode !== ed) n = n.parentNode; return n; };
  const insertHTML = (h) => { restore(); document.execCommand('insertHTML', false, h); keep(); };
  document.querySelectorAll('#etb [data-cmd]').forEach((el) => {
    const run = () => {
      restore();
      const v = el.tagName === 'BUTTON' ? null : el.value;
      if (el.tagName === 'SELECT' && !v) return;
      document.execCommand(el.dataset.cmd, false, el.dataset.cmd === 'formatBlock' ? `<${v}>` : v);
      if (el.tagName === 'SELECT') el.value = '';
      keep();
    };
    if (el.tagName === 'BUTTON') { el.onmousedown = (e) => e.preventDefault(); el.onclick = run; } else el.onchange = run;
  });
  document.querySelectorAll('#etb [data-x]').forEach((el) => {
    const x = el.dataset.x;
    const run = () => {
      if (x === 'imgsize') { if (lastImg && el.value) lastImg.style.width = el.value; el.value = ''; return; }
      restore();
      const sel = getSelection();
      const node = sel.anchorNode;
      if (x === 'check') {
        const ul = node && (node.nodeType === 1 ? node : node.parentNode).closest?.('ul');
        if (ul && ed.contains(ul)) ul.classList.toggle('check');
        else insertHTML('<ul class="check"><li>할 일</li></ul><p><br></p>');
      } else if (x === 'step') {
        const n = ed.querySelectorAll('.step').length + 1;
        insertHTML(`<div class="step"><span class="sn">${String(n).padStart(2, '0')}</span><div>내용을 쓰세요</div></div><p><br></p>`);
      } else if (x.startsWith('box:')) {
        const kind = x.slice(4);
        const tb = node && topBlock(node);
        if (tb && tb.classList?.contains('box')) { tb.className = 'box ' + kind; return; }
        const text = sel.toString();
        const head = kind === 'warn' ? '<p><b>⚠️ 원장님 확인 전이에요. 확정된 기준으로 쓰지 마세요.</b></p>' : '';
        if (tb && !text) { const box = document.createElement('div'); box.className = 'box ' + kind; box.innerHTML = head; tb.replaceWith(box); box.appendChild(tb); }
        else insertHTML(`<div class="box ${kind}">${head}<p>${text ? esc(text) : '내용을 쓰세요'}</p></div><p><br></p>`);
      } else if (x === 'unbox') {
        const tb = node && topBlock(node);
        if (tb?.classList?.contains('box')) tb.replaceWith(...tb.childNodes);
      } else if (x === 'cite') {
        const b = prompt('근거를 적어 주세요 (예: 성찰노트 11/20, 원장님 지시, 제품 설명서)', '');
        if (b === null) return;
        insertHTML(` <span class="cite2">(${today()} 추가${b ? ' · 근거: ' + esc(b) : ''})</span>&nbsp;`);
      } else if (x === 'table') {
        insertHTML('<table class="mt"><thead><tr><th>항목</th><th>내용</th><th>비고</th></tr></thead><tbody><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></tbody></table><p><br></p>');
      } else if (x === 'hr') insertHTML('<hr><p><br></p>');
    };
    if (el.tagName === 'BUTTON') { el.onmousedown = (e) => e.preventDefault(); el.onclick = run; } else el.onchange = run;
  });
  document.getElementById('eimg').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    toast('사진을 줄이는 중…');
    const data = await compressImage(f);
    const id = 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    newImgs[id] = data; mimg[id] = data;
    insertHTML(`<figure><img data-img="${id}" src="${data}" alt="" style="width:55%"><figcaption>사진 설명</figcaption></figure><p><br></p>`);
    e.target.value = '';
  };
  void blockOf;
}
function bodyForSave(ed) {
  const c = ed.cloneNode(true);
  c.querySelectorAll('img[data-img]').forEach((i) => { i.removeAttribute('src'); i.classList.remove('sel'); });
  c.querySelectorAll('img:not([data-img])').forEach((i) => { if ((i.getAttribute('src') || '').startsWith('data:') && i.src.length > 200000) i.remove(); });
  return cleanHtml(c.innerHTML);
}
async function saveImages(newImgs, body) {
  for (const [id, data] of Object.entries(newImgs)) if (body.includes(id)) await setDoc(doc(db, 'manualImages', id), { data, at: serverTimestamp() });
}
async function addMLog(e) {
  await addDoc(collection(db, 'manualLog'), { status: 'applied', by: me.name, at: serverTimestamp(), date: today(), ...e });
  mlogs = null;
}

async function renderManualEdit(id) {
  const isNew = id === null;
  const p = isNew ? { title: '', group: sub?.group || mcache.tree.groups[0]?.name || '공통', sub: '', body: '<p></p>' } : (mcache.pages[id] || { title: id === '_home' ? '홈' : MTABS.check, body: '<p></p>' });
  const special = id?.startsWith('_');
  const groups = mcache.tree.groups.map((g) => g.name);
  const subs = [...new Set(mPages().map((x) => x.sub).filter(Boolean))];
  shell(`
    <div class="crumb">원내매뉴얼 / ${isNew ? '새 페이지' : '편집'}</div>
    <h1>${isNew ? '새 매뉴얼 페이지' : '✏️ ' + esc(p.title) + ' 편집'}</h1>
    <section class="card form mform">
      <label>제목<input id="mt" value="${esc(p.title)}"></label>
      ${special ? '' : `<div class="row">
        <label>큰 제목(그룹)<select id="mg">${groups.map((g) => `<option ${g === p.group ? 'selected' : ''}>${esc(g)}</option>`).join('')}<option value="__new">+ 새 그룹…</option></select></label>
        <label>작은 제목 (선택)<input id="ms" list="msubs" value="${esc(p.sub || '')}" placeholder="예: 근관치료"><datalist id="msubs">${subs.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>
        <label>번호 (선택)<input id="mc" value="${esc(p.code || '')}" placeholder="예: 04.01"></label></div>`}
    </section>
    ${editorToolbar()}
    <div class="mdoc editor" id="ed" contenteditable="true">${cleanHtml(p.body)}</div>
    <section class="card form">
      <label>무엇이 바뀌었나요? <small class="muted">(매뉴얼 업데이트 리뷰에 기록돼요)</small><input id="msum" placeholder="${isNew ? '새 페이지 추가' : '예: 러버댐 클램프 선택 기준 추가'}"></label>
      <label>근거 (선택)<input id="mbasis" placeholder="예: 성찰노트 11/20, 원장님 지시, 제품 설명서"></label>
    </section>
    <div class="row"><button class="primary" id="save">저장</button><button class="ghost" id="cancel">취소</button>${!isNew && !special ? '<button class="ghost danger" id="del">🗑️ 페이지 삭제</button>' : ''}</div>`);
  const ed = document.getElementById('ed');
  const newImgs = {};
  hydrateImages(ed);
  bindEditor(ed, newImgs);
  document.getElementById('mg')?.addEventListener('change', (e) => {
    if (e.target.value !== '__new') return;
    const n = prompt('새 그룹 이름');
    if (!n) { e.target.value = groups[0]; return; }
    const o = document.createElement('option'); o.textContent = n; o.selected = true; e.target.insertBefore(o, e.target.lastChild);
  });
  document.getElementById('cancel').onclick = () => go('manual', isNew ? null : id.startsWith('_') ? (id === '_home' ? null : { tab: 'check' }) : { id });
  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm(`"${p.title}" 페이지를 삭제할까요? 되돌릴 수 없어요.`)) return;
    await deleteDoc(doc(db, 'manuals', id));
    await addMLog({ pageId: id, title: p.title, summary: '페이지 삭제' });
    toast('삭제했어요'); await loadManual(true); go('manual');
  });
  document.getElementById('save').onclick = async () => {
    const btn = document.getElementById('save'); btn.disabled = true;
    try {
      const body = bodyForSave(ed);
      if (body.length > 900000) { alert('페이지가 너무 커요. 내용을 두 페이지로 나눠 주세요.'); btn.disabled = false; return; }
      const title = val('mt') || '제목 없음';
      const data = { title, body, updatedAt: serverTimestamp(), updatedBy: me.name };
      if (!special) {
        const g = document.getElementById('mg').value;
        Object.assign(data, { group: g, sub: val('ms'), code: val('mc') });
        if (!mcache.tree.groups.some((x) => x.name === g)) { mcache.tree.groups.push({ name: g }); await setDoc(doc(db, 'manualMeta', 'tree'), { groups: mcache.tree.groups }); }
        if (isNew) data.order = Math.max(0, ...mPages().map((x) => x.order ?? 0)) + 1;
      }
      await saveImages(newImgs, body);
      let pid = id;
      if (isNew) pid = (await addDoc(collection(db, 'manuals'), data)).id;
      else await setDoc(doc(db, 'manuals', id), data, { merge: true });
      await addMLog({ pageId: pid, title, summary: val('msum') || (isNew ? '새 페이지 추가' : '내용 수정'), basis: val('mbasis') });
      toast('저장했어요'); await loadManual(true);
      go('manual', pid === '_home' ? null : pid === '_check' ? { tab: 'check' } : { id: pid });
    } catch (e) { console.error(e); alert('저장하지 못했어요: ' + (e.code || e.message)); btn.disabled = false; }
  };
}

// ---------- 업데이트 기록 ----------
let mlogs = null;
async function getMLogs() {
  if (mlogs) return mlogs;
  const s = await getDocs(query(collection(db, 'manualLog'), orderBy('at', 'desc')));
  mlogs = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  return mlogs;
}
// 제목(afterHeading) 아래 단락 끝에 내용 넣기
function insertAfterHeading(body, after, html) {
  const d = document.createElement('div'); d.innerHTML = body;
  const hs = [...d.querySelectorAll('h2,h3')];
  const norm = (s) => s.replace(/\s+/g, '').replace(/^part\d+\./i, '').toLowerCase();
  const h = after ? hs.find((x) => norm(x.textContent) === norm(after)) || hs.find((x) => norm(x.textContent).includes(norm(after))) : null;
  const frag = document.createElement('div'); frag.innerHTML = html;
  if (!h) { d.append(...frag.childNodes); return d.innerHTML; }
  const lvl = Number(h.tagName[1]);
  let n = h;
  while (n.nextElementSibling && !(/^H[23]$/.test(n.nextElementSibling.tagName) && Number(n.nextElementSibling.tagName[1]) <= lvl) && !n.nextElementSibling.matches('.refs')) n = n.nextElementSibling;
  n.after(...frag.childNodes);
  return d.innerHTML;
}
function proposalHtml(c) {
  const tag = ` <span class="cite2">(${today()} 추가${c.basis ? ' · 근거: ' + esc(c.basis) : ''})</span>`;
  let h = cleanHtml(c.html || '');
  if (!/<[a-z]/i.test(h)) h = `<p>${esc(c.html || '')}</p>`;
  h = h.replace(/(<\/(p|li|div)>)(?![\s\S]*<\/(p|li|div)>)/, tag + '$1');
  if (!h.includes('cite2')) h += `<p>${tag}</p>`;
  if (c.needsCheck) h = `<div class="box warn"><p><b>⚠️ 원장님 확인 전이에요. 확정된 기준으로 쓰지 마세요.</b></p>${h}</div>`;
  return h;
}

async function renderMLog() {
  const logs = await getMLogs();
  const admin = can.editManual();
  const pend = logs.filter((l) => l.status === 'pending');
  const done = logs.filter((l) => l.status === 'applied');
  const pageLink = (l) => mcache.pages[l.pageId] ? `<a href="#" data-pg="${l.pageId}">${esc(l.title || mcache.pages[l.pageId].title)}</a>` : esc(l.title || '');
  shell(`
    <div class="crumb">원내매뉴얼</div>
    <div class="row between"><div><h1>🔄 매뉴얼 업데이트 리뷰</h1>
      <p class="muted">언제, 어떤 내용이, 왜 바뀌었는지 기록돼요.${admin ? ' AI가 제안한 내용은 승인해야 매뉴얼에 반영돼요.' : ''}</p></div>
      ${admin ? '<button class="primary" id="ai">🤖 AI로 내용 추가</button>' : ''}</div>
    ${admin ? `<section class="card"><div class="row between"><h3>승인 대기 ${pend.length}건</h3>${pend.length > 1 ? '<button class="primary sm" id="allOk">전체 승인</button>' : ''}</div>
      ${pend.length ? pend.map((l) => `
        <div class="prop" data-id="${l.id}">
          <div class="row between"><div><b>${esc(l.title)}</b> <span class="muted sm">· ${esc(l.date || '')} · ${esc(l.by || '')}</span></div>
            <div class="row"><button class="primary sm" data-ok="${l.id}">✅ 승인</button><button class="ghost sm" data-no="${l.id}">✕ 거절</button></div></div>
          <div class="box info"><p><b>변경 요약:</b> ${esc(l.summary)}${l.basis ? ` <span class="cite2">(근거: ${esc(l.basis)})</span>` : ''}</p></div>
          <div class="tabs"><button class="on" data-v="new">새 버전 (AI 제안)</button><button data-v="cur">현재 버전</button></div>
          <div class="mdoc propView" data-new></div><div class="mdoc propView" data-cur hidden></div>
        </div>`).join('') : '<div class="empty">✅ 승인 대기 중인 업데이트가 없어요.</div>'}</section>` : ''}
    <section class="card"><h3>업데이트 기록</h3>
      <table class="mt logT"><thead><tr><th>날짜</th><th>매뉴얼</th><th>바뀐 내용</th><th>근거</th><th>작성</th></tr></thead><tbody>
      ${done.map((l) => `<tr><td class="nowrap">${dstr(l.at) || esc(l.date || '')}</td><td>${pageLink(l)}</td><td>${esc(l.summary)}</td><td>${esc(l.basis || '')}</td><td class="nowrap">${esc(l.by || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">아직 기록이 없어요.</td></tr>'}
      </tbody></table></section>`);
  $app.querySelectorAll('[data-pg]').forEach((a) => a.onclick = (e) => { e.preventDefault(); go('manual', { id: a.dataset.pg }); });
  if (!admin) return;
  document.getElementById('ai').onclick = () => aiBridge();
  const newBody = (l) => { const p = mcache.pages[l.pageId]; return insertAfterHeading(p?.body || '', l.after, l.html); };
  for (const l of pend) {
    const box = $app.querySelector(`.prop[data-id="${l.id}"]`);
    const nv = box.querySelector('[data-new]'), cv = box.querySelector('[data-cur]');
    const nb = newBody(l);
    nv.innerHTML = cleanHtml(nb); cv.innerHTML = cleanHtml(mcache.pages[l.pageId]?.body || '<p class="muted">새 페이지</p>');
    [...nv.querySelectorAll('span.cite2')].filter((s) => s.textContent.includes(today() + ' 추가')).forEach((s) => s.closest('p,li,div')?.classList.add('newHi'));
    const hi = nv.querySelector('.newHi');
    if (hi) setTimeout(() => { nv.scrollTop += hi.getBoundingClientRect().top - nv.getBoundingClientRect().top - 60; }, 50);
    hydrateImages(nv); hydrateImages(cv);
    box.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
      box.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      nv.hidden = b.dataset.v !== 'new'; cv.hidden = b.dataset.v === 'new';
    });
  }
  const approve = async (l) => {
    const p = mcache.pages[l.pageId];
    if (!p) { alert(`"${l.title}" 페이지를 찾을 수 없어요.`); return false; }
    const body = insertAfterHeading(p.body, l.after, l.html);
    await setDoc(doc(db, 'manuals', l.pageId), { body, updatedAt: serverTimestamp(), updatedBy: me.name + ' (AI 제안 승인)' }, { merge: true });
    p.body = body;
    await updateDoc(doc(db, 'manualLog', l.id), { status: 'applied', at: serverTimestamp(), approvedBy: me.name });
    for (const s of l.sources || []) { try { await updateDoc(doc(db, s.col, s.id), s.col === 'notes' ? { reflected: true } : { status: '반영' }); } catch (e) { /* 무시 */ } }
    return true;
  };
  $app.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    if (await approve(pend.find((l) => l.id === b.dataset.ok))) { toast('매뉴얼에 반영했어요'); mlogs = null; await loadManual(true); renderMLog(); }
  });
  $app.querySelectorAll('[data-no]').forEach((b) => b.onclick = async () => {
    if (!confirm('이 제안을 거절할까요?')) return;
    await deleteDoc(doc(db, 'manualLog', b.dataset.no)); mlogs = null; toast('거절했어요'); await loadManual(true); renderMLog();
  });
  document.getElementById('allOk')?.addEventListener('click', async () => {
    if (!confirm(`${pend.length}건을 모두 승인할까요?`)) return;
    for (const l of pend) await approve(l);
    toast('모두 반영했어요'); mlogs = null; await loadManual(true); renderMLog();
  });
}

// AI로 내용 추가: 성찰노트·개선요청 → Claude에게 보낼 글 복사 → 답 붙여넣기 → 승인 대기
async function aiBridge() {
  const [ns, rs] = await Promise.all([getDocs(collection(db, 'notes')), getDocs(collection(db, 'manualReqs'))]);
  const notes = ns.docs.map((d) => ({ id: d.id, ...d.data() })).filter((n) => !n.reflected);
  const reqs = rs.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !['반영', '보류'].includes(r.status));
  const w = document.createElement('div'); w.className = 'modal';
  const item = (col, x, label) => `<label class="aiItem"><input type="checkbox" data-col="${col}" data-id="${x.id}" checked> <span><b>${label}</b> ${esc(x.name || '')} · ${esc(x.date || '')}${x.pageTitle ? ' · ' + esc(x.pageTitle) : ''}<br><small>${esc(((x.mistake || x.text || '') + (x.plan ? ' / 개선: ' + x.plan : '') + (x.feedback ? ' / 피드백: ' + x.feedback : '')).slice(0, 140))}</small></span></label>`;
  w.innerHTML = `<div class="modalBox">
    <h2>🤖 AI로 내용 추가</h2>
    <p class="muted sm">선택한 성찰노트·개선 요청을 바탕으로 AI가 매뉴얼의 알맞은 위치에 넣을 내용을 제안해요. 제안은 <b>승인해야</b> 반영돼요.</p>
    <h3>1. 반영할 내용 고르기</h3>
    <div class="aiList">${notes.map((n) => item('notes', n, '📝 성찰노트')).join('')}${reqs.map((r) => item('manualReqs', r, '💬 개선 요청')).join('') || ''}
      ${!notes.length && !reqs.length ? '<p class="muted">아직 반영하지 않은 성찰노트·개선 요청이 없어요.</p>' : ''}</div>
    <label>원장님 추가 지시 (선택)<textarea id="aiMore" rows="3" placeholder="예: 러버댐 페이지에 클램프 보관 위치는 2번 서랍이라고 추가해 줘"></textarea></label>
    <h3>2. 복사해서 Claude에게 보내기</h3>
    <p class="muted sm">아래 버튼을 누르면 내용이 복사돼요. Claude 대화창에 붙여넣고 보내세요.</p>
    <button class="primary" id="aiCopy">📋 Claude에게 보낼 내용 복사</button>
    <h3>3. Claude의 답 붙여넣기</h3>
    <textarea id="aiAns" rows="6" placeholder="Claude가 준 답(코드 블록 포함)을 그대로 붙여넣으세요"></textarea>
    <div class="row"><button class="primary" id="aiMake">제안 만들기</button><button class="ghost" id="aiClose">닫기</button></div>
  </div>`;
  document.body.appendChild(w);
  document.getElementById('aiClose').onclick = () => w.remove();
  const chosen = () => [...w.querySelectorAll('.aiList input:checked')].map((c) => {
    const src = c.dataset.col === 'notes' ? notes : reqs;
    return { col: c.dataset.col, ...src.find((x) => x.id === c.dataset.id) };
  });
  document.getElementById('aiCopy').onclick = async () => {
    const items = chosen(); const more = document.getElementById('aiMore').value.trim();
    if (!items.length && !more) { alert('반영할 내용을 고르거나 추가 지시를 써 주세요.'); return; }
    const outline = mPages().sort(mSort).map((p) => {
      const d = document.createElement('div'); d.innerHTML = p.body;
      return `- id=${p.id} | ${p.group}${p.sub ? ' > ' + p.sub : ''} > ${p.title} | 소제목: ${[...d.querySelectorAll('h2,h3')].map((h) => h.textContent.trim()).join(' / ')}`;
    }).join('\n');
    const related = [...new Set(items.map((i) => i.pageId).filter(Boolean))].map((id) => mcache.pages[id]).filter(Boolean)
      .map((p) => `### ${p.title} (id=${p.id})\n${plainText(p.body).slice(0, 3500)}`).join('\n\n');
    const fb = items.map((i, k) => `[${k + 1}] ${i.col === 'notes' ? '성찰노트' : '개선요청'} · ${i.name || ''} · ${i.date || ''}${i.pageTitle ? ' · 관련: ' + i.pageTitle : ''}\n${i.mistake ? '실수·지적: ' + i.mistake + '\n' : ''}${i.plan ? '개선 계획: ' + i.plan + '\n' : ''}${i.text ? '내용: ' + i.text + '\n' : ''}${i.feedback ? '원장님 피드백: ' + i.feedback + '\n' : ''}`).join('\n');
    const prompt = `너는 치과 원내 매뉴얼 편집자야. 아래 직원 피드백을 매뉴얼의 알맞은 페이지·소제목 아래에 넣을 내용으로 정리해 줘.

규칙
- 이미 매뉴얼에 있는 내용과 겹치면 넣지 마.
- 직원 실명은 본문에 쓰지 말고, basis(근거)에만 "성찰노트 11/20"처럼 짧게 써.
- 문장은 짧고 쉽게, "~해요"체. 필요하면 <p>, <ul><li>, <ul class="check"><li> (체크리스트), <b> 만 써.
- 원장님 확인이 필요한 임상 판단·수치는 needsCheck: true 로 표시해.
- afterHeading 에는 아래 목차의 소제목 글자를 그대로 써. 맞는 소제목이 없으면 null(페이지 끝).

답은 아래 형식의 JSON 코드 블록 하나로만 줘.
\`\`\`json
{"changes":[{"pageId":"03-00","afterHeading":"Part 3. 진료 흐름과 어시스트","html":"<p>…</p>","summary":"무엇을 추가했는지 한 줄","basis":"성찰노트 11/20","needsCheck":false,"items":[1]}]}
\`\`\`
(items 는 아래 피드백 번호)

## 피드백
${fb || '(없음)'}
${more ? '\n## 원장님 추가 지시\n' + more + '\n' : ''}
## 매뉴얼 목차
${outline}
${related ? '\n## 관련 페이지 본문\n' + related : ''}`;
    try { await navigator.clipboard.writeText(prompt); toast('복사했어요. Claude 대화창에 붙여넣으세요'); }
    catch (e) { const t = document.getElementById('aiAns'); t.value = prompt; t.select(); alert('자동 복사가 안 돼서 아래 칸에 넣었어요. 전체 선택 후 복사(Ctrl+C)해 주세요.'); }
    w.dataset.items = JSON.stringify(items.map((i) => ({ col: i.col, id: i.id })));
  };
  document.getElementById('aiMake').onclick = async () => {
    const raw = document.getElementById('aiAns').value;
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
    let data;
    try { data = JSON.parse(m ? m[1] : raw); } catch (e) { alert('답을 읽지 못했어요. Claude 답의 코드 블록을 그대로 붙여넣어 주세요.'); return; }
    const items = JSON.parse(w.dataset.items || '[]');
    let n = 0;
    for (const c of data.changes || []) {
      const p = mcache.pages[c.pageId];
      if (!p) continue;
      const sources = (c.items || []).map((k) => items[k - 1]).filter(Boolean);
      await addDoc(collection(db, 'manualLog'), {
        status: 'pending', pageId: c.pageId, title: p.title, after: c.afterHeading || null, html: proposalHtml(c),
        summary: c.summary || '내용 추가', basis: c.basis || '', sources, by: 'AI 제안', date: today(), at: serverTimestamp()
      });
      n++;
    }
    w.remove(); mlogs = null;
    toast(n ? `${n}건의 제안을 만들었어요. 확인 후 승인해 주세요` : '만들 제안이 없어요');
    await loadManual(true); renderMLog();
  };
}

// ---------- 직원 성찰노트 ----------
async function renderNotes() {
  const s = await getDocs(query(collection(db, 'notes'), orderBy('at', 'desc')));
  const all = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const boss = canApprove();
  const f = sub?.who || '전체';
  const counts = {}; all.forEach((n) => counts[n.name] = (counts[n.name] || 0) + 1);
  const list = all.filter((n) => f === '전체' || n.name === f);
  const pageOpts = (sel) => `<option value="">(선택 안 함)</option>` + mcache.tree.groups.map((g) => `<optgroup label="${esc(g.name)}">${mPages().filter((p) => p.group === g.name).sort(mSort).map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</optgroup>`).join('');
  shell(`
    <div class="crumb">원내매뉴얼</div>
    <h1>📝 직원 성찰노트</h1>
    <p class="muted">실수하거나 지적받은 내용, 앞으로의 개선 계획을 적어요. 평가가 아니라 <b>매뉴얼을 함께 키우는 재료</b>예요.</p>
    <details class="card" id="wbox" ${sub?.write ? 'open' : ''}><summary class="primaryLink">✍️ 성찰노트 쓰기</summary>
      <div class="form">
        <label>관련 매뉴얼 (선택)<select id="np">${pageOpts(sub?.write || '')}</select></label>
        <label>실수·지적 내용<textarea id="nm" rows="4"></textarea></label>
        <label>개선 계획<textarea id="npl" rows="3"></textarea></label>
        <button class="primary" id="nsave">저장</button>
      </div></details>
    <div class="chips noteChips"><button data-w="전체" class="${f === '전체' ? 'on' : ''}">전체 (${all.length})</button>${Object.entries(counts).map(([n, c]) => `<button data-w="${esc(n)}" class="${f === n ? 'on' : ''}">${esc(n)} (${c})</button>`).join('')}</div>
    ${list.map((n) => `
      <section class="card note" data-id="${n.id}">
        <div class="row between"><b class="nname">${esc(n.name)}</b><span class="muted sm">${esc(n.date || dstr(n.at))}${n.reflected ? ' · <span class="tag">매뉴얼 반영됨</span>' : ''}</span></div>
        ${n.pageId && mcache.pages[n.pageId] ? `<a href="#" class="sm" data-pg="${n.pageId}">📘 ${esc(mcache.pages[n.pageId].title)}</a>` : ''}
        <div class="nlab">실수·지적 내용</div><div class="ntext">${esc(n.mistake)}</div>
        ${n.plan ? `<div class="nlab">개선 계획</div><div class="ntext">${esc(n.plan)}</div>` : ''}
        ${n.feedback && !boss ? `<div class="box tip"><p><b>💬 피드백</b> <span class="muted sm">${esc(n.feedbackBy || '')}</span></p><div class="ntext">${esc(n.feedback)}</div></div>` : ''}
        ${boss ? `<textarea class="fb" rows="2" placeholder="피드백 남기기 (저장 전까지 직원에게 안 보여요)">${esc(n.feedback || '')}</textarea>
          <div class="row"><button class="primary sm" data-fb="${n.id}">피드백 저장</button><label class="chk sm"><input type="checkbox" data-rf="${n.id}" ${n.reflected ? 'checked' : ''}> 매뉴얼 반영됨</label>
          ${n.uid === me.uid ? `<button class="ghost sm" data-del="${n.id}">삭제</button>` : `<button class="ghost sm danger" data-del="${n.id}">삭제</button>`}</div>`
        : n.uid === me.uid ? `<div class="row"><button class="ghost sm" data-del="${n.id}">삭제</button></div>` : ''}
      </section>`).join('') || '<section class="card muted">아직 작성된 성찰노트가 없어요.</section>'}`);
  $app.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => go('manual', { tab: 'notes', who: b.dataset.w }));
  $app.querySelectorAll('[data-pg]').forEach((a) => a.onclick = (e) => { e.preventDefault(); go('manual', { id: a.dataset.pg }); });
  document.getElementById('nsave').onclick = async () => {
    const mistake = document.getElementById('nm').value.trim(), plan = document.getElementById('npl').value.trim();
    if (!mistake) { alert('실수·지적 내용을 적어 주세요.'); return; }
    const pid = document.getElementById('np').value;
    await addDoc(collection(db, 'notes'), { uid: me.uid, name: me.name, pageId: pid, pageTitle: pid ? mcache.pages[pid]?.title || '' : '', mistake, plan, date: today(), at: serverTimestamp(), reflected: false });
    toast('저장했어요'); go('manual', { tab: 'notes' });
  };
  $app.querySelectorAll('[data-fb]').forEach((b) => b.onclick = async () => {
    const t = b.closest('.note').querySelector('.fb').value.trim();
    await updateDoc(doc(db, 'notes', b.dataset.fb), { feedback: t, feedbackBy: me.name, feedbackAt: serverTimestamp() });
    toast('피드백을 저장했어요');
  });
  $app.querySelectorAll('[data-rf]').forEach((c) => c.onchange = () => updateDoc(doc(db, 'notes', c.dataset.rf), { reflected: c.checked }));
  $app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('이 성찰노트를 삭제할까요?')) return;
    await deleteDoc(doc(db, 'notes', b.dataset.del)); toast('삭제했어요'); renderNotes();
  });
}

// ---------- 개선 요청 ----------
async function renderReqs() {
  const s = await getDocs(query(collection(db, 'manualReqs'), orderBy('at', 'desc')));
  const all = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const boss = canApprove();
  const stCls = { '접수': '', '검토 중': 'st-ing', '반영': 'st-ok', '보류': 'st-hold' };
  shell(`
    <div class="crumb">원내매뉴얼</div>
    <h1>💬 개선 요청</h1>
    <p class="muted">매뉴얼 형식, 빠진 내용, 틀린 내용 등 무엇이든 남겨 주세요.</p>
    <section class="card form">
      <label>관련 매뉴얼 (선택)<select id="rp"><option value="">(선택 안 함)</option>${mPages().sort(mSort).map((p) => `<option value="${p.id}" ${p.id === sub?.write ? 'selected' : ''}>${esc(p.group)} · ${esc(p.title)}</option>`).join('')}</select></label>
      <label>요청 내용<textarea id="rt" rows="3" placeholder="예: 근관치료 페이지에 파일 순서 사진이 있으면 좋겠어요"></textarea></label>
      <button class="primary" id="rsave">요청 남기기</button>
    </section>
    ${all.map((r) => `
      <section class="card note" data-id="${r.id}">
        <div class="row between"><div><b>${esc(r.name)}</b> <span class="stTag ${stCls[r.status || '접수']}">${esc(r.status || '접수')}</span></div><span class="muted sm">${esc(r.date || dstr(r.at))}</span></div>
        ${r.pageId && mcache.pages[r.pageId] ? `<a href="#" class="sm" data-pg="${r.pageId}">📘 ${esc(mcache.pages[r.pageId].title)}</a>` : ''}
        <div class="ntext">${esc(r.text)}</div>
        ${r.reply && !boss ? `<div class="box tip"><p><b>답변</b> <span class="muted sm">${esc(r.replyBy || '')}</span></p><div class="ntext">${esc(r.reply)}</div></div>` : ''}
        ${boss ? `<textarea class="fb" rows="2" placeholder="답변 남기기">${esc(r.reply || '')}</textarea>
          <div class="row"><select class="rst">${REQ_ST.map((x) => `<option ${x === (r.status || '접수') ? 'selected' : ''}>${x}</option>`).join('')}</select><button class="primary sm" data-rp="${r.id}">저장</button><button class="ghost sm danger" data-del="${r.id}">삭제</button></div>`
        : r.uid === me.uid ? `<div class="row"><button class="ghost sm" data-del="${r.id}">삭제</button></div>` : ''}
      </section>`).join('') || '<section class="card muted">아직 요청이 없어요.</section>'}`);
  $app.querySelectorAll('[data-pg]').forEach((a) => a.onclick = (e) => { e.preventDefault(); go('manual', { id: a.dataset.pg }); });
  document.getElementById('rsave').onclick = async () => {
    const text = document.getElementById('rt').value.trim(); if (!text) { alert('요청 내용을 적어 주세요.'); return; }
    const pid = document.getElementById('rp').value;
    await addDoc(collection(db, 'manualReqs'), { uid: me.uid, name: me.name, pageId: pid, pageTitle: pid ? mcache.pages[pid]?.title || '' : '', text, status: '접수', date: today(), at: serverTimestamp() });
    toast('요청을 남겼어요'); go('manual', { tab: 'req' });
  };
  $app.querySelectorAll('[data-rp]').forEach((b) => b.onclick = async () => {
    const c = b.closest('.note');
    await updateDoc(doc(db, 'manualReqs', b.dataset.rp), { reply: c.querySelector('.fb').value.trim(), replyBy: me.name, status: c.querySelector('.rst').value });
    toast('저장했어요'); renderReqs();
  });
  $app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('이 요청을 삭제할까요?')) return;
    await deleteDoc(doc(db, 'manualReqs', b.dataset.del)); toast('삭제했어요'); renderReqs();
  });
}

// ---------- 목차·가져오기 (관리자) ----------
async function renderMAdmin() {
  const g = mcache.tree.groups.map((x) => ({ ...x }));
  const pages = mPages().map((p) => ({ id: p.id, title: p.title, group: p.group, sub: p.sub || '', order: p.order ?? 9999 })).sort(mSort);
  const draw = () => {
    shell(`
      <div class="crumb">원내매뉴얼 / 관리자</div>
      <h1>🗂️ 목차·가져오기</h1>
      <section class="card"><h3>📥 매뉴얼 파일 가져오기</h3>
        <p class="muted sm">Claude가 만들어 준 매뉴얼 파일(.json)을 올리면 목차와 페이지가 한 번에 들어가요. 같은 페이지가 있으면 새 내용으로 바뀌어요.</p>
        <div class="row"><label class="upload">📥 파일 고르기<input type="file" id="mimp" accept=".json" hidden></label><button class="ghost" id="mexp">📤 전체 백업 내려받기</button></div>
        <p id="mprog" class="muted sm"></p></section>
      <section class="card"><div class="row between"><h3>큰 제목(그룹) 순서</h3><button class="sm" id="gadd">+ 그룹 추가</button></div>
        ${g.map((x, i) => `<div class="trow"><input data-gn="${i}" value="${esc(x.name)}"><button class="sm ghost" data-gu="${i}">↑</button><button class="sm ghost" data-gd="${i}">↓</button>${pages.some((p) => p.group === x.name) ? '' : `<button class="sm ghost danger" data-gx="${i}">삭제</button>`}</div>`).join('')}
      </section>
      <section class="card"><h3>페이지 위치</h3><p class="muted sm">그룹과 작은 제목을 바꾸거나 ↑↓로 순서를 바꾼 뒤 아래 <b>저장</b>을 눌러요.</p>
        ${g.map((x) => `<h4 class="tgrp">${esc(x.name)}</h4>` + pages.filter((p) => p.group === x.name).map((p) => `
          <div class="trow" data-p="${p.id}"><span class="ttl">${esc(p.title)}</span>
            <input data-ps="${p.id}" value="${esc(p.sub)}" placeholder="작은 제목">
            <select data-pg2="${p.id}">${g.map((y) => `<option ${y.name === p.group ? 'selected' : ''}>${esc(y.name)}</option>`).join('')}</select>
            <button class="sm ghost" data-pu="${p.id}">↑</button><button class="sm ghost" data-pd="${p.id}">↓</button></div>`).join('')).join('')}
      </section>
      <div class="row"><button class="primary" id="tsave">저장</button></div>`);
    const renameMap = {};
    $app.querySelectorAll('[data-gn]').forEach((inp) => inp.onchange = () => { const i = +inp.dataset.gn; const old = g[i].name; g[i].name = inp.value.trim() || old; pages.forEach((p) => { if (p.group === old) p.group = g[i].name; }); renameMap[old] = g[i].name; draw(); });
    const mv = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
    $app.querySelectorAll('[data-gu]').forEach((b) => b.onclick = () => { mv(g, +b.dataset.gu, -1); draw(); });
    $app.querySelectorAll('[data-gd]').forEach((b) => b.onclick = () => { mv(g, +b.dataset.gd, 1); draw(); });
    $app.querySelectorAll('[data-gx]').forEach((b) => b.onclick = () => { g.splice(+b.dataset.gx, 1); draw(); });
    document.getElementById('gadd').onclick = () => { const n = prompt('새 그룹 이름'); if (n) { g.push({ name: n }); draw(); } };
    $app.querySelectorAll('[data-ps]').forEach((inp) => inp.onchange = () => { pages.find((p) => p.id === inp.dataset.ps).sub = inp.value.trim(); });
    $app.querySelectorAll('[data-pg2]').forEach((s) => s.onchange = () => { const p = pages.find((x) => x.id === s.dataset.pg2); p.group = s.value; p.order = 99999; draw(); });
    const pmv = (id, d) => {
      const p = pages.find((x) => x.id === id); const same = pages.filter((x) => x.group === p.group);
      const i = same.indexOf(p), j = i + d; if (j < 0 || j >= same.length) return;
      const o = p.order; p.order = same[j].order; same[j].order = o; if (p.order === same[j].order) p.order += d;
      pages.sort((a, b) => a.order - b.order); draw();
    };
    $app.querySelectorAll('[data-pu]').forEach((b) => b.onclick = () => pmv(b.dataset.pu, -1));
    $app.querySelectorAll('[data-pd]').forEach((b) => b.onclick = () => pmv(b.dataset.pd, 1));
    document.getElementById('tsave').onclick = async () => {
      const btn = document.getElementById('tsave'); btn.disabled = true;
      await setDoc(doc(db, 'manualMeta', 'tree'), { groups: g.map((x) => ({ name: x.name })) });
      let k = 0;
      for (const x of g) for (const p of pages.filter((y) => y.group === x.name)) {
        const old = mcache.pages[p.id]; k++;
        if (old.group !== p.group || (old.sub || '') !== p.sub || old.order !== k) await setDoc(doc(db, 'manuals', p.id), { group: p.group, sub: p.sub, order: k }, { merge: true });
      }
      toast('저장했어요'); await loadManual(true); go('manual', { tab: 'admin' });
    };
    document.getElementById('mexp').onclick = async () => {
      const imgs = {}; for (const d of (await getDocs(collection(db, 'manualImages'))).docs) imgs[d.id] = d.data().data;
      const out = { type: 'plaire-manual-init', version: 1, createdAt: today(), tree: mcache.tree, pages: mPages().map(({ _text, updatedAt, ...p }) => p),
        special: Object.fromEntries(['_home', '_check'].filter((id) => mcache.pages[id]).map((id) => [id, { title: mcache.pages[id].title, body: mcache.pages[id].body }])), images: imgs };
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
      a.download = `매뉴얼_백업_${today()}.json`; a.click();
    };
    document.getElementById('mimp').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      let d; try { d = JSON.parse(await f.text()); } catch (er) { alert('파일을 읽지 못했어요.'); return; }
      if (d.type !== 'plaire-manual-init') { alert('매뉴얼 파일이 아니에요.'); return; }
      if (!confirm(`페이지 ${d.pages.length}개, 사진 ${Object.keys(d.images || {}).length}장을 가져올까요?\n같은 페이지가 있으면 새 내용으로 바뀌어요.`)) return;
      const pr = document.getElementById('mprog'); let i = 0; const total = d.pages.length + Object.keys(d.images || {}).length + 2;
      const step = (t) => { i++; pr.textContent = `가져오는 중… ${i}/${total} ${t}`; };
      try {
        for (const [id, data] of Object.entries(d.images || {})) { await setDoc(doc(db, 'manualImages', id), { data, at: serverTimestamp() }); step('사진'); }
        for (const p of d.pages) { const { id, ...rest } = p; await setDoc(doc(db, 'manuals', id), { ...rest, updatedAt: serverTimestamp(), updatedBy: me.name }); step(p.title); }
        for (const [id, p] of Object.entries(d.special || {})) await setDoc(doc(db, 'manuals', id), { ...p, updatedAt: serverTimestamp(), updatedBy: me.name });
        step('특별 페이지');
        const names = (d.tree?.groups || []).map((x) => x.name);
        const merged = [...names.map((n) => ({ name: n })), ...mcache.tree.groups.filter((x) => !names.includes(x.name))];
        await setDoc(doc(db, 'manualMeta', 'tree'), { groups: merged }); step('목차');
        for (const l of d.log || []) await addMLog({ pageId: '', ...l });
        toast('가져왔어요'); await loadManual(true); go('manual');
      } catch (er) { console.error(er); alert('가져오는 중 문제가 생겼어요: ' + (er.code || er.message)); }
    };
  };
  draw();
}

// ---------- 연차·근무표 ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
// 우리 치과 기준: 오전반차 0.4일, 오후반차 0.6일
const LEAVE_TYPES = { '연차': '종일', '오전반차': '오전반차', '오후반차': '오후반차' };
const HALF = { '오전반차': 0.4, '오후반차': 0.6 };
const canApprove = () => ['admin', 'chief'].includes(me?.role);
const daysOf = (l) => HALF[l.type] ?? Number(l.days ?? (l.hours || 0) / 8);
function fmtD(d) { return `${Math.round(d * 10) / 10}일`; }

// 연차 사용기한 = 다음 입사기념일 하루 전 (예: 입사 2025-02-05 → 2027-02-04)
const dayBefore = (d) => { const x = new Date(d); x.setDate(x.getDate() - 1); return ymd(x); };
const ddayOf = (s) => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((parseD(s) - t) / 86400000); };
const ddayCls = (n) => n <= 30 ? 'dd-red' : n <= 60 ? 'dd-yellow' : '';
const ddayTxt = (n) => n > 0 ? `D-${n}` : n === 0 ? 'D-DAY' : `D+${-n}`;
// 연차 대상 아님: 직원 명부에서 체크했거나, 대표원장
const noLeave = (u, titleMap = {}) => u.noLeave === true || (u.noLeave === undefined && /대표원장/.test(`${u.job || ''} ${titleMap[u.name] || ''}`));

// 근로기준법 기준 연차 (입사일 기준, 출근율 80% 이상 가정)
// - 입사 1년 미만: 1개월 개근마다 1일 (최대 11일)
// - 1년 이상: 15일, 3년차부터 2년마다 1일 가산 (최대 25일)
function leavePeriod(hireDate, today = new Date()) {
  if (!hireDate) return null;
  const h = parseD(hireDate);
  let years = today.getFullYear() - h.getFullYear();
  const anniv = new Date(today.getFullYear(), h.getMonth(), h.getDate());
  if (today < anniv) years--;
  if (years < 0) return { start: hireDate, end: hireDate, days: 0, label: '입사 전', next: null };
  if (years < 1) {
    let months = (today.getFullYear() - h.getFullYear()) * 12 + today.getMonth() - h.getMonth();
    if (today.getDate() < h.getDate()) months--;
    months = Math.max(0, Math.min(11, months));
    const end = new Date(h); end.setFullYear(end.getFullYear() + 1);
    const next = new Date(h); next.setMonth(h.getMonth() + months + 1);
    return { start: hireDate, end: ymd(end), last: dayBefore(end), days: months, label: `입사 1년 미만 · 근속 ${months}개월`,
      next: months < 11 ? `다음 연차 발생일 ${ymd(next)} (+1일)` : `1년이 되는 ${ymd(end)}에 15일 발생` };
  }
  const start = new Date(h); start.setFullYear(h.getFullYear() + years);
  const end = new Date(start); end.setFullYear(end.getFullYear() + 1);
  const days = Math.min(25, 15 + Math.floor((years - 1) / 2));
  const nextDays = Math.min(25, 15 + Math.floor(years / 2));
  return { start: ymd(start), end: ymd(end), last: dayBefore(end), days, label: `근속 ${years}년 (${years + 1}년차)`,
    next: `${ymd(end)}에 ${nextDays}일 새로 발생` };
}
function balanceOf(user, leaves) {
  const p = leavePeriod(user.hireDate);
  const adj = Number(user.annualAdjust || 0);
  const mine = leaves.filter((l) => l.uid === user.uid);
  const approved = mine.filter((l) => l.status === '승인' && (!p || (l.start >= p.start && l.start < p.end)));
  const inPeriod = approved.filter((l) => isDeduct(l.type));
  const kinds = { '종일': { h: 0, n: 0 }, '오전반차': { h: 0, n: 0 }, '오후반차': { h: 0, n: 0 } };
  inPeriod.forEach((l) => { const k = kinds[LEAVE_TYPES[l.type]]; k.h += daysOf(l); k.n++; });
  const others = {}; approved.filter((l) => !isDeduct(l.type)).forEach((l) => { const o = (others[l.type] ||= { h: 0, n: 0 }); o.h += daysOf(l); o.n++; });
  const used = inPeriod.reduce((s, l) => s + daysOf(l), 0);
  const total = (p?.days || 0) + adj;
  return { total, used, left: total - used, period: p, kinds, others, pending: mine.filter((l) => l.status === '대기').length };
}
function countDays(start, end, type) {
  if (HALF[type]) return HALF[type];
  let n = 0;
  for (let d = parseD(start); d <= parseD(end); d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) n++;
  return n;
}
async function loadLeaves() {
  const col = collection(db, 'leaves');
  const q = canApprove() ? col : query(col, where('uid', '==', me.uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.start.localeCompare(a.start));
}
// 승인된 연차를 근무표에 반영 (code가 null이면 지움)
async function stampLeave(l, code) {
  const byMonth = {};
  const days = HALF[l.type] ? [l.start] : [];
  if (!days.length) for (let d = parseD(l.start); d <= parseD(l.end); d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) days.push(ymd(d));
  days.forEach((s) => { (byMonth[s.slice(0, 7)] ||= []).push(Number(s.slice(8))); });
  for (const [month, ds] of Object.entries(byMonth)) {
    const ref = doc(db, 'schedules', month);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : { people: [], cells: {} };
    data.cells ||= {}; data.cells[l.uid] ||= {}; data.people ||= [];
    ds.forEach((d) => { if (code) data.cells[l.uid][d] = code; else delete data.cells[l.uid][d]; });
    if (!data.people.some((p) => p.uid === l.uid)) data.people.push({ uid: l.uid, name: l.name, team: l.team || '' });
    await setDoc(ref, data);
  }
}
const stampCode = (l) => ({ '종일': '연차', '오전반차': '오전반차', '오후반차': '오후반차' })[LEAVE_TYPES[l.type]] || l.type;

async function renderWork() {
  const tab = sub?.tab || 'schedule';
  if (tab === 'leave') return renderMyLeave();
  if (tab === 'all' && canApprove()) return renderLeaveAll();
  return renderSchedule();
}

// 연차 대시보드 (한 사람)
function leaveDash(user, leaves) {
  const b = balanceOf(user, leaves);
  const k = b.kinds;
  const sum = b.used || 1;
  const pct = (h) => (h / sum * 100).toFixed(1) + '%';
  return `
    ${b.period ? (() => { const n = ddayOf(b.period.last); return `
      <div class="leftBanner ${ddayCls(n)}">
        <div><small>정산 잔여</small><b>${fmtD(b.left)}</b></div>
        <div><small>사용기한</small><b>${b.period.last}</b><span class="ddTag">${ddayTxt(n)}</span></div>
        <div class="sm">${n <= 60 ? '⏰ 사용기한이 얼마 남지 않았어요. 남은 연차를 계획해 주세요.' : '남은 연차는 사용기한까지 사용해 주세요.'}</div>
      </div>
      <p class="muted sm">${b.period.label} · 연차 기간 ${b.period.start} ~ ${b.period.last}${b.period.next ? ' · ' + b.period.next : ''}</p>`; })()
      : '<p class="msg">입사일이 등록되지 않아 연차를 계산할 수 없어요. 직원 명부에서 입사일을 넣어 주세요.</p>'}
    <div class="kpis">
      <div class="kpi"><span>부여</span><b>${fmtD(b.total)}</b>${Number(user.annualAdjust || 0) ? `<small>조정 ${user.annualAdjust > 0 ? '+' : ''}${user.annualAdjust}일 포함</small>` : ''}</div>
      <div class="kpi"><span>사용</span><b>${fmtD(b.used)}</b></div>
      <div class="kpi"><span>잔여</span><b class="${b.left < 0 ? 'neg' : 'accent'}">${fmtD(b.left)}</b></div>
      <div class="kpi"><span>신청 대기</span><b>${b.pending}건</b></div>
    </div>
    <section class="card">
      <div class="row between"><div><h2>사용 형태별 합계</h2><p class="muted sm">승인된 신청을 연차 차감량으로 환산했어요. (오전반차 0.4일 · 오후반차 0.6일)</p></div>
        <div class="right"><small class="muted">총합</small><div class="bigNum">${fmtD(b.used)}</div></div></div>
      <div class="kinds">
        <div><span class="ki k1">📅</span> 종일<b>${fmtD(k['종일'].h)}</b><small>${k['종일'].n}회</small></div>
        <div><span class="ki k2">🌅</span> 오전반차<b>${fmtD(k['오전반차'].h)}</b><small>${k['오전반차'].n}회 × 0.4일</small></div>
        <div><span class="ki k3">🌇</span> 오후반차<b>${fmtD(k['오후반차'].h)}</b><small>${k['오후반차'].n}회 × 0.6일</small></div>
      </div>
      <div class="bar">${b.used ? `<i class="b1" style="width:${pct(k['종일'].h)}"></i><i class="b2" style="width:${pct(k['오전반차'].h)}"></i><i class="b3" style="width:${pct(k['오후반차'].h)}"></i>` : ''}</div>
      ${Object.keys(b.others).length ? `<p class="sm" style="margin-top:.8rem"><b>연차 차감 없는 휴가</b> · ${Object.entries(b.others).map(([t, o]) => `${esc(t)} ${fmtD(o.h)} (${o.n}회)`).join(' · ')}</p>` : ''}
    </section>`;
}
function leaveRow(l, actions = '', files = null) {
  const when = l.start + (l.end && l.end !== l.start ? ' ~ ' + l.end : '');
  return `<div class="lv">
    <div><b>${esc(l.name)}</b> <span class="muted sm"><span class="tag ${isDeduct(l.type) ? '' : 'gray'}">${esc(l.type)}</span> ${when} · ${fmtD(daysOf(l))}${isDeduct(l.type) ? '' : ' (차감 없음)'}</span>
      ${l.reason ? `<div class="sm muted">${esc(l.reason)}</div>` : ''}${files?.[l.id] ? `<div class="sm">${fileLinks(files[l.id])}</div>` : ''}</div>
    <div class="row"><span class="tag ${l.status === '승인' ? '' : 'gray'}">${l.status}</span>${actions}</div></div>`;
}
function bindLeaveActions(leaves, back) {
  const find = (id) => leaves.find((l) => l.id === id);
  $app.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
    const l = find(b.dataset.ok); b.disabled = true;
    await updateDoc(doc(db, 'leaves', l.id), { status: '승인', decidedBy: me.name });
    await stampLeave(l, stampCode(l));
    toast('승인하고 근무표에 반영했어요'); back();
  });
  $app.querySelectorAll('[data-no]').forEach((b) => b.onclick = async () => {
    await updateDoc(doc(db, 'leaves', b.dataset.no), { status: '반려', decidedBy: me.name });
    toast('반려했어요'); back();
  });
  $app.querySelectorAll('[data-undo]').forEach((b) => b.onclick = async () => {
    if (!confirm('승인을 취소할까요? 근무표에서도 지워져요.')) return;
    const l = find(b.dataset.undo);
    await updateDoc(doc(db, 'leaves', l.id), { status: '반려', decidedBy: me.name });
    await stampLeave(l, null);
    toast('승인을 취소했어요'); back();
  });
  $app.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => {
    if (!confirm('신청을 취소할까요? 첨부한 파일도 함께 지워져요.')) return;
    const fm = await loadLeaveFiles();
    for (const f of fm[b.dataset.cancel] || []) await deleteLeaveFile(f);
    await deleteDoc(doc(db, 'leaves', b.dataset.cancel)); toast('취소했어요'); back();
  });
}
const approverActions = (l) => l.status === '대기' ? `<button data-ok="${l.id}" class="primary sm">승인</button><button data-no="${l.id}" class="ghost sm">반려</button>`
  : l.status === '승인' ? `<button data-undo="${l.id}" class="ghost sm danger">승인 취소</button>` : '';

// ---------- 휴가 구분 · 신청서 · 첨부파일 ----------
const LEAVE_KINDS = ['연차', '오전반차', '오후반차', '무급', '군소집훈련', '여성보건', '출산전후', '출산전후(다태아)', '출산전후(미숙아)', '유산(사산)',
  '배우자출산', '육아휴직', '난임치료휴가(유급)', '난임치료휴가(무급)', '임산부 건강진단', '경조', '기타', '병가'];
const isDeduct = (t) => !!LEAVE_TYPES[t];   // 연차·오전반차·오후반차만 연차에서 차감
const FILE_MAX = 5 * 1024 * 1024, FILE_COUNT = 5, CHUNK = 700000;

async function loadLeaveFiles() {
  const col = collection(db, 'leaveFiles');
  const snap = await getDocs(canApprove() ? col : query(col, where('uid', '==', me.uid)));
  const map = {};
  snap.docs.forEach((d) => { const x = { id: d.id, ...d.data() }; (map[x.leaveId] ||= []).push(x); });
  return map;
}
// 파일은 카드 등록 없이 쓰도록 데이터베이스에 잘게 나눠 저장 (본인·관리자·총괄실장만 열람)
async function saveLeaveFile(leaveId, uid, file) {
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
  const n = Math.ceil(b64.length / CHUNK);
  const meta = await addDoc(collection(db, 'leaveFiles'), { leaveId, uid, name: file.name, type: file.type, size: file.size, chunks: n, createdAt: serverTimestamp(), by: me.name });
  for (let i = 0; i < n; i++) await setDoc(doc(db, 'leaveFiles', meta.id, 'chunks', String(i)), { d: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
}
async function deleteLeaveFile(f) {
  for (let i = 0; i < (f.chunks || 0); i++) await deleteDoc(doc(db, 'leaveFiles', f.id, 'chunks', String(i))).catch(() => {});
  await deleteDoc(doc(db, 'leaveFiles', f.id));
}
async function openLeaveFile(f) {
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font-family:sans-serif;padding:2rem">파일을 여는 중…</p>');
  const parts = [];
  for (let i = 0; i < f.chunks; i++) parts.push((await getDoc(doc(db, 'leaveFiles', f.id, 'chunks', String(i)))).data()?.d || '');
  const bin = atob(parts.join('')); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: f.type || 'application/octet-stream' }));
  if (w) w.location = url; else { const a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); }
}
const fileLinks = (files) => (files || []).map((f) => `<a href="#" class="fileLink" data-fid="${f.id}">📎 ${esc(f.name)}</a>`).join(' ');
function bindFileLinks(fileMap) {
  const all = Object.values(fileMap).flat();
  $app.querySelectorAll('[data-fid]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openLeaveFile(all.find((f) => f.id === a.dataset.fid)); });
}

// 휴가신청서 (인쇄용)
function leaveFormDoc(v) {
  return `<div class="lform">
    <h2>휴 가 신 청 서</h2>
    <table class="slipTbl">
      <tr><th>성명</th><td>${esc(v.name)}</td><th>소속</th><td>${esc([v.dept, v.team].filter(Boolean).join(' / ') || '-')}</td></tr>
      <tr><th>직위</th><td>${esc(v.job || '-')}</td><th>휴가 구분</th><td>${esc(v.type)}</td></tr>
      <tr><th>기간</th><td colspan="3">${v.start}${v.end && v.end !== v.start ? ' ~ ' + v.end : ''} (${fmtD(v.days)})</td></tr>
      <tr><th>사유</th><td colspan="3" class="tall">${esc(v.reason || '')}</td></tr>
    </table>
    <p class="center">위와 같이 휴가를 신청합니다.</p>
    <p class="center">${v.today.replace(/-/g, '. ')}.</p>
    <p class="right">신청인 : ${esc(v.name)} (서명)</p>
    <table class="slipTbl sign"><tr><th>담당</th><th>총괄실장</th><th>대표원장</th></tr><tr><td></td><td></td><td></td></tr></table>
    <p class="center"><b>${esc(theme.clinicName)}</b></p>
  </div>`;
}

// 휴가 신청 양식 (직원: 본인 / 관리자·총괄실장: 직원 선택·즉시 승인)
function leaveFormHtml({ admin, people }) {
  const today = ymd(new Date());
  return `
    <section class="card form" id="reqCard" style="display:none">
      <h2>${admin ? '휴가 등록' : '휴가 신청'}</h2>
      ${admin ? `<div class="note" id="lnote" style="display:none">ℹ️ 이 직원은 아직 계정과 연결되어 있지 않아요. 신청·승인은 정상 처리되고, 직원 본인은 가입해서 명부와 연결된 뒤 내 연차에서 확인할 수 있어요.</div>` : ''}
      <div class="lfGrid ${admin ? 'adm' : ''}">
        ${admin ? `<label>직원<select id="lp"><option value="">선택</option>${people.map((p) => `<option value="${p.uid}">${esc(p.name)}${p.status === 'roster' ? ' (계정 미연결)' : ''}</option>`).join('')}</select></label>` : ''}
        <label>휴가 구분<select id="lt"><option value="">선택</option>${LEAVE_KINDS.map((t) => `<option value="${t}">${t}${HALF[t] ? ` (${HALF[t]}일)` : ''}</option>`).join('')}</select></label>
        <label>시작일<input type="date" id="ls" value="${today}"></label>
        <label>종료일<input type="date" id="le" value="${today}"></label>
        <label>일수<input type="number" id="ld" step="0.1" min="0" value="1"></label>
      </div>
      <p class="muted sm" id="lhint"></p>
      <label>사유 (선택)<input id="lr" placeholder="예: 개인 사정, 가족 행사"></label>
      <b class="sm">서류 첨부 (선택)</b>
      <div class="row" style="margin:.4rem 0">
        <button id="lformBtn" class="ghost sm" disabled>📝 휴가신청서 작성</button>
        <label class="upload ghostUp sm">📎 파일 올리기<input type="file" id="lfile" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple hidden></label>
      </div>
      <div id="lfiles" class="row"></div>
      <p class="muted sm">휴가 구분을 먼저 고르면 휴가신청서를 작성할 수 있어요. PDF, JPG, PNG 파일을 파일당 5MB까지, 최대 5개까지 올릴 수 있어요. 진단서 등 첨부파일은 본인과 관리자·총괄실장만 볼 수 있어요.</p>
      ${admin ? `<label class="row sm"><input type="checkbox" id="linst" checked> 즉시 승인</label>
        <div class="note sm">ℹ️ 체크를 해제하면 '대기' 상태로 등록되어 승인 대기 목록에서 따로 승인해야 해요.</div>` : ''}
      <div class="row"><button id="lsend" class="primary">휴가 신청</button><button id="closeReq" class="ghost">닫기</button></div>
    </section>`;
}
function bindLeaveForm({ admin, people, after }) {
  const card = document.getElementById('reqCard');
  document.getElementById('openReq').onclick = () => { card.style.display = ''; card.scrollIntoView({ behavior: 'smooth' }); };
  document.getElementById('closeReq').onclick = () => { card.style.display = 'none'; };
  const files = [];
  const drawFiles = () => {
    document.getElementById('lfiles').innerHTML = files.map((f, i) => `<span class="tag gray">📎 ${esc(f.name)} (${(f.size / 1024 / 1024).toFixed(1)}MB) <a href="#" data-rm="${i}">✕</a></span>`).join('');
    document.querySelectorAll('[data-rm]').forEach((a) => a.onclick = (e) => { e.preventDefault(); files.splice(+a.dataset.rm, 1); drawFiles(); });
  };
  document.getElementById('lfile').onchange = (e) => {
    for (const f of e.target.files) {
      if (!/pdf|jpe?g|png/i.test(f.type + f.name)) { toast(`${f.name}: PDF, JPG, PNG만 올릴 수 있어요`); continue; }
      if (f.size > FILE_MAX) { toast(`${f.name}: 5MB를 넘어요`); continue; }
      if (files.length >= FILE_COUNT) { toast('최대 5개까지 올릴 수 있어요'); break; }
      files.push(f);
    }
    e.target.value = ''; drawFiles();
  };
  const who = () => admin ? people.find((p) => p.uid === val('lp')) : me;
  const upd = (auto = true) => {
    const t = val('lt'), half = !!HALF[t];
    document.getElementById('le').disabled = half;
    if (half) document.getElementById('le').value = val('ls');
    const s = val('ls'), e = val('le');
    if (auto && t && s && e >= s) document.getElementById('ld').value = countDays(s, e, t);
    document.getElementById('ld').disabled = half;
    document.getElementById('lformBtn').disabled = !t;
    document.getElementById('lhint').textContent = !t ? '' : isDeduct(t) ? `연차에서 ${fmtD(Number(val('ld')) || 0)} 차감돼요.${half ? '' : ' (일요일 제외로 계산, 필요하면 일수를 고쳐 주세요)'}` : '연차에서 차감되지 않는 휴가예요. 일수는 필요하면 직접 고쳐 주세요.';
    if (admin) document.getElementById('lnote').style.display = who()?.status === 'roster' ? '' : 'none';
  };
  ['lt', 'ls', 'le'].forEach((id) => document.getElementById(id).oninput = () => upd(true));
  document.getElementById('ld').oninput = () => upd(false);
  if (admin) document.getElementById('lp').onchange = () => upd(false);
  upd(true);
  document.getElementById('lformBtn').onclick = () => {
    const p = who(); if (!p) return toast('직원을 먼저 골라 주세요');
    const v = { name: p.name, dept: p.dept, team: p.team, job: p.job, type: val('lt'), start: val('ls'), end: val('le'), days: Number(val('ld')) || 0, reason: val('lr'), today: ymd(new Date()) };
    const w = document.createElement('div'); w.className = 'modal printable';
    w.innerHTML = `<div class="modalBox">${leaveFormDoc(v)}<div class="row noprint"><button class="primary" id="pf">🖨️ 인쇄 / PDF 저장</button><button class="ghost" id="cf">닫기</button></div></div>`;
    document.body.appendChild(w);
    w.querySelector('#cf').onclick = () => w.remove();
    w.querySelector('#pf').onclick = () => { document.body.classList.add('printModal'); window.print(); document.body.classList.remove('printModal'); };
  };
  document.getElementById('lsend').onclick = async (ev) => {
    const p = who(); if (!p) return toast('직원을 골라 주세요');
    const type = val('lt'); if (!type) return toast('휴가 구분을 골라 주세요');
    const start = val('ls'), end = HALF[type] ? start : val('le');
    if (!start || end < start) return toast('날짜를 확인해 주세요');
    const days = HALF[type] || Number(val('ld')) || 0;
    const instant = admin && document.getElementById('linst').checked;
    ev.target.disabled = true; ev.target.textContent = files.length ? '파일 올리는 중…' : '처리 중…';
    const data = { uid: p.uid, name: p.name, team: p.team || '', type, start, end, days, deduct: isDeduct(type), reason: val('lr'),
      status: instant ? '승인' : '대기', files: files.length, createdAt: serverTimestamp(), createdBy: me.name, ...(instant ? { decidedBy: me.name } : {}) };
    const ref = await addDoc(collection(db, 'leaves'), data);
    for (const f of files) await saveLeaveFile(ref.id, p.uid, f);
    if (instant) await stampLeave({ ...data, id: ref.id }, stampCode(data));
    toast(instant ? '등록하고 근무표에 반영했어요' : '신청했어요'); after();
  };
}

const DEFAULT_RULES = '';
async function rulesSection() {
  const d = await getDoc(doc(db, 'settings', 'leaveRules'));
  const text = d.exists() ? d.data().text || '' : DEFAULT_RULES;
  return { text, html: `
    <section class="card" id="rulesCard">
      <div class="row between"><h2>📖 우리 치과 연차 사용 규칙</h2>${me.role === 'admin' ? '<button id="editRules" class="ghost sm">수정</button>' : ''}</div>
      <div class="manual" id="rulesBody">${text ? esc(text) : '<span class="muted">아직 등록된 규칙이 없어요.</span>'}</div>
    </section>` };
}
function bindRules(text) {
  document.getElementById('editRules')?.addEventListener('click', () => {
    document.getElementById('rulesBody').outerHTML = `<div id="rulesBody"><textarea id="rulesText" rows="12" placeholder="예)\n1. 연차는 사용 2주 전까지 신청합니다.\n2. 같은 팀은 같은 날 2명 이상 연차를 쓸 수 없습니다.\n3. 반차는 오전 9:30~13:30 / 오후 14:30~18:30 기준입니다.">${esc(text)}</textarea>
      <div class="row"><button id="saveRules" class="primary">저장</button></div></div>`;
    document.getElementById('editRules').remove();
    document.getElementById('saveRules').onclick = async () => {
      await setDoc(doc(db, 'settings', 'leaveRules'), { text: document.getElementById('rulesText').value, updatedAt: serverTimestamp(), updatedBy: me.name });
      toast('규칙을 저장했어요'); render();
    };
  });
}

async function renderMyLeave() {
  const leaves = (await loadLeaves()).filter((l) => l.uid === me.uid);
  const tm = {}; ((await loadOrg()).groups || []).forEach((g) => (g.members || []).forEach((m) => { tm[m.name] = m.title || ''; }));
  if (noLeave(me, tm)) return shell(`<p class="eyebrow">MY LEAVE</p><h1>내 연차</h1><section class="card"><p class="muted">연차 관리 대상이 아니에요.</p></section>`);
  const rules = await rulesSection();
  const fileMap = await loadLeaveFiles();
  shell(`
    <div class="row between"><div><p class="eyebrow">MY LEAVE</p><h1>내 연차</h1><p class="muted sm">연차 신청 내역을 확인하고 새로운 신청을 합니다.</p></div>
      <button id="openReq" class="primary">＋ 휴가 신청</button></div>
    ${leaveFormHtml({ admin: false })}
    ${leaveDash(me, leaves)}
    <section class="card"><h2>내 신청 내역</h2>
      ${leaves.map((l) => leaveRow(l, l.status === '대기' ? `<button data-cancel="${l.id}" class="ghost sm">취소</button>` : '', fileMap)).join('') || '<p class="muted">아직 신청 내역이 없어요.</p>'}
    </section>
    ${rules.html}`);
  bindLeaveForm({ admin: false, after: () => go('work', { tab: 'leave' }) });
  bindFileLinks(fileMap);
  bindLeaveActions(leaves, () => go('work', { tab: 'leave' }));
  bindRules(rules.text);
}

// 관리자·총괄실장: 직원 전체 연차 현황
async function renderLeaveAll() {
  const leaves = await loadLeaves();
  const fileMap = await loadLeaveFiles();
  const people = (await loadPeople()).filter((p) => ['active', 'roster'].includes(p.status) && (p.work || '재직') !== '퇴사');
  const back = () => go('work', { tab: 'all', uid: sub?.uid });

  if (sub?.uid) {
    const p = people.find((x) => x.uid === sub.uid);
    if (!p) return go('work', { tab: 'all' });
    const mine = leaves.filter((l) => l.uid === p.uid);
    shell(`
      <button id="back" class="ghost">← 전체 현황</button>
      <h1>${esc(p.name)} <span class="muted sm">${esc(p.job || '')}${p.team ? ' · ' + esc(p.team) : ''} · 입사 ${p.hireDate || '-'}</span></h1>
      ${leaveDash(p, leaves)}
      <section class="card"><h2>사용 내역</h2>${mine.map((l) => leaveRow(l, approverActions(l), fileMap)).join('') || '<p class="muted">내역이 없어요.</p>'}</section>`);
    document.getElementById('back').onclick = () => go('work', { tab: 'all' });
    bindFileLinks(fileMap);
    bindLeaveActions(leaves, back);
    return;
  }

  const pending = leaves.filter((l) => l.status === '대기');
  const org = await loadOrg();
  const tm = {}, deptOf = {}; (org.groups || []).forEach((g) => (g.members || []).forEach((m) => { tm[m.name] = m.title || ''; deptOf[m.name] = g.name; }));
  const rows = people.filter((p) => !noLeave(p, tm)).map((p) => ({ p, b: balanceOf(p, leaves) }))
    .sort((a, b) => b.b.left - a.b.left || a.p.name.localeCompare(b.p.name, 'ko'));
  const ord = orgOrder(org); const rk = (n) => { const i = ord.findIndex((o) => o.name === n); return i < 0 ? 999 : i; };
  const formPeople = [...people].sort((a, b) => rk(a.name) - rk(b.name) || a.name.localeCompare(b.name, 'ko'));
  const month = sub?.month || '';
  const months = [...new Set(leaves.map((l) => l.start.slice(0, 7)))].sort().reverse();
  const hist = leaves.filter((l) => !month || l.start.startsWith(month));
  shell(`
    <div class="row between"><div><p class="eyebrow">LEAVE OVERVIEW</p><h1>직원 연차 현황</h1></div><button id="openReq" class="primary">＋ 휴가 등록</button></div>
    ${leaveFormHtml({ admin: true, people: formPeople })}
    <div class="kpis">
      <div class="kpi"><span>연차 대상</span><b>${rows.length}명</b></div>
      <div class="kpi"><span>전체 부여</span><b>${fmtD(rows.reduce((s, r) => s + r.b.total, 0))}</b></div>
      <div class="kpi"><span>전체 사용</span><b>${fmtD(rows.reduce((s, r) => s + r.b.used, 0))}</b></div>
      <div class="kpi"><span>승인 대기</span><b class="${pending.length ? 'accent' : ''}">${pending.length}건</b></div>
    </div>
    ${pending.length ? `<section class="card warn"><h2>승인 대기 (${pending.length})</h2>${pending.map((l) => leaveRow(l, approverActions(l), fileMap)).join('')}</section>` : ''}
    <section class="card">
      <h2>직원별 연차</h2>
      <div class="tbl"><table>
        <tr><th>이름</th><th>부서</th><th>팀</th><th>입사일</th><th>근속</th><th>사용기한</th><th>남은 날</th><th>부여</th><th>사용</th><th>잔여</th><th>사용률</th><th>대기</th></tr>
        ${rows.map(({ p, b }) => { const n = b.period ? ddayOf(b.period.last) : null; return `<tr class="click" data-u="${p.uid}">
          <td><b>${esc(p.name)}</b>${p.status === 'roster' ? ' <span class="tag gray">미가입</span>' : ''}</td>
          <td>${esc(p.dept || deptOf[p.name] || '-')}</td><td>${esc(p.team || '-')}</td>
          <td>${p.hireDate || '<span class="msg">미등록</span>'}</td><td class="sm">${b.period ? b.period.label.replace('입사 1년 미만 · ', '') : '-'}</td>
          <td>${b.period ? b.period.last : '-'}</td><td>${n === null ? '-' : `<span class="ddTag ${ddayCls(n)}">${ddayTxt(n)}</span>`}</td>
          <td>${fmtD(b.total)}</td><td>${fmtD(b.used)}</td><td><b class="${b.left < 0 ? 'neg' : ''}">${fmtD(b.left)}</b></td>
          <td><div class="mini"><i style="width:${b.total ? Math.min(100, b.used / b.total * 100) : 0}%"></i></div></td><td>${b.pending || ''}</td></tr>`; }).join('')}
      </table></div>
      <p class="muted sm">잔여일이 많은 순서예요. 사용기한(다음 입사기념일 하루 전)까지 <span class="ddTag dd-yellow">60일 이내</span> <span class="ddTag dd-red">30일 이내</span>는 색으로 표시돼요. 이름을 누르면 그 직원의 연차 대시보드를 볼 수 있어요.<br>대표원장처럼 연차 대상이 아닌 사람은 목록에서 빠져요. (직원 명부 → "연차 대상 아님"으로 바꿀 수 있어요)</p>
    </section>
    <section class="card">
      <div class="row between"><h2>전체 사용 내역</h2>
        <select id="mon" style="width:auto;flex:none"><option value="">전체 기간</option>${months.map((m) => `<option ${m === month ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      ${hist.slice(0, 200).map((l) => leaveRow(l, approverActions(l), fileMap)).join('') || '<p class="muted">내역이 없어요.</p>'}
    </section>`);
  $app.querySelectorAll('tr[data-u]').forEach((tr) => tr.onclick = () => go('work', { tab: 'all', uid: tr.dataset.u }));
  document.getElementById('mon').onchange = (e) => go('work', { tab: 'all', month: e.target.value });
  bindLeaveActions(leaves, () => go('work', { tab: 'all', month }));
  bindLeaveForm({ admin: true, people: formPeople, after: () => go('work', { tab: 'all' }) });
  bindFileLinks(fileMap);
}

// ---------- 급여 관리 (관리자) ----------
// 세무사무소 급상여대장 항목 그대로
// 급여대장에서 읽는 전체 지급 항목 / 화면·명세서에 기본으로 보이는 항목
const PAY_ALL = ['기본급', '연장수당', '상여', '여름휴가비', '교통비지원', '초과근무수당', '식대', '직책수당', '월차수당', '자가운전보조금', '야간근로수당', '미사용연차수당'];
const PAY_ITEMS = ['기본급', '연장수당', '상여', '교통비지원', '초과근무수당', '식대', '미사용연차수당'];
const hiddenPay = (r) => PAY_ALL.filter((k) => !PAY_ITEMS.includes(k)).reduce((s, k) => s + num(r.pay?.[k]), 0);
// 회사 부담 4대보험: 직원 공제액을 바탕으로 계산 (2026년 기준)
// 국민연금·건강보험·장기요양 = 직원과 같은 금액, 고용보험 = 직원분 × 1.15/0.9 (실업급여 0.9% + 고용안정·직업능력개발 0.25%, 150인 미만),
// 산재보험 = (지급액 − 식대) × 산재 요율(관리자가 입력)
function employerOf(r, accRate = 0) {
  const d = r.ded || {}, r10 = (x) => Math.round(x / 10) * 10;
  const x = { '국민연금': num(d['국민연금']), '건강보험': num(d['건강보험']), '장기요양보험': num(d['장기요양보험']),
    '고용보험': r10(num(d['고용보험']) * 1.15 / 0.9), '산재보험': r10((payOf(r) - num(r.pay?.['식대'])) * accRate / 100) };
  return { ...x, total: Object.values(x).reduce((a, b) => a + b, 0) };
}
const DED_ITEMS = ['국민연금', '건강보험', '장기요양보험', '고용보험', '소득세', '지방소득세', '농특세', '중도정산소득세', '중도정산지방소득세'];
const ROLE_RANK = { admin: 0, doctor: 1, chief: 2, leader: 3, staff: 4 };
const num = (v) => Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
const comma = (n) => Math.round(n).toLocaleString('ko-KR');
const payOf = (r) => Object.values(r.pay || {}).reduce((s, v) => s + num(v), 0);
const dedOf = (r) => Object.values(r.ded || {}).reduce((s, v) => s + num(v), 0);
const netOf = (r) => payOf(r) - dedOf(r);
const costOf = (r) => payOf(r) + num(r.retire) + num(r.support);
const monthTitle = (month) => { const [y, m] = month.split('-').map(Number); return `${y}년 ${m}월분`; };

// 급상여대장 엑셀 읽기: 3줄이 한 직원 (사번·성명·지급·공제 / 입사일·직위·… / 퇴사일·부서·합계)
async function parsePayrollExcel(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const norm = (v) => String(v ?? '').replace(/\s+/g, '');
  const flat = rows.slice(0, 15).map((r) => r.join(' ')).join(' ');
  const mm = flat.match(/(\d{4})\s*년\s*(\d{1,2})\s*월분/) || flat.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
  const pd = flat.match(/지급일\s*:?\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const month = mm ? `${mm[1]}-${pad(mm[2])}` : null;
  const payDate = pd ? `${pd[1]}-${pad(pd[2])}-${pad(pd[3])}` : '';
  const h = rows.findIndex((r) => r.some((c) => norm(c) === '사원번호'));
  if (h < 0) throw new Error('"사원번호" 머리글을 찾지 못했어요. 급상여대장 엑셀이 맞는지 확인해 주세요.');
  const pos = {};   // 항목 이름 → [줄 위치, 열]
  for (let off = 0; off < 3; off++) (rows[h + off] || []).forEach((c, col) => { const k = norm(c); if (k) pos[k] = [off, col]; });
  const at = (r, k) => pos[k] ? (rows[r + pos[k][0]] || [])[pos[k][1]] : '';
  const people = [];
  for (let r = h + 3; r < rows.length; r++) {
    const sabun = norm(at(r, '사원번호')), name = norm(at(r, '성명'));
    if (!/^\d+$/.test(sabun) || !name) continue;
    const pay = {}, ded = {};
    PAY_ALL.forEach((k) => { const v = num(at(r, k)); if (v) pay[k] = v; });
    DED_ITEMS.forEach((k) => { const v = num(at(r, k)); if (v) ded[k] = v; });
    const fix = (d) => { const s = String(d || '').trim().replace(/\./g, '-'); return /^\d{4}-\d{1,2}-\d{1,2}$/.test(s) ? s.split('-').map((x, i) => i ? pad(x) : x).join('-') : ''; };
    people.push({ sabun, name, pay, ded, hireDate: fix(at(r, '입사일')), quitDate: fix(at(r, '퇴사일')), job: String(at(r, '직위') || '').trim(), dept: String(at(r, '부서') || '').trim(),
      filePay: num(at(r, '지급합계')), fileDed: num(at(r, '공제합계')), fileNet: num(at(r, '차인지급액')) });
    r += 2;
  }
  if (!people.length) throw new Error('직원 급여 내용을 찾지 못했어요.');
  return { month, payDate, people };
}

async function renderPayroll() {
  const now = new Date();
  const month = sub?.month || `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const [y, m] = month.split('-').map(Number);
  const shift = (k) => { const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const all = await loadPeople();
  const ref = doc(db, 'payroll', month);
  const snap = await getDoc(ref);
  const saved = snap.exists() ? snap.data() : {};
  const rows = JSON.parse(JSON.stringify(saved.rows || {}));
  let payDate = saved.payDate || '';
  if (sub?.imported) { Object.assign(rows, sub.imported.rows); payDate = sub.imported.payDate || payDate; }
  const sal = {};
  (await getDocs(collection(db, 'salaries'))).docs.forEach((d) => { sal[d.id] = d.data(); });
  const conf = (await getDoc(doc(db, 'settings', 'payrollConf'))).data() || {};
  let accRate = Number(conf.accRate || 0);
  const monthlyOf = (uid) => sal[uid]?.annual ? Math.round(sal[uid].annual / 12) : num(sal[uid]?.monthly);
  const retireOf = (uid) => { const m = monthlyOf(uid); return m ? Math.round(m / 12) : 0; };   // 퇴직연금: 세전 월급여의 1/12
  const current = all.filter((p) => ['active', 'roster'].includes(p.status) && (p.work || '재직') !== '퇴사');
  const ids = [...new Set([...current.map((p) => p.uid), ...Object.keys(rows)])];
  const pord = orgOrder(await loadOrg()); const prk = (n) => { const i = pord.findIndex((o) => o.name === n); return i < 0 ? 999 : i; };
  const people = ids.map((id) => all.find((p) => p.uid === id) || { uid: id, name: rows[id]?.name || '(삭제된 직원)', role: 'staff' })
    .sort((a, b) => prk(a.name) - prk(b.name) || (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || a.name.localeCompare(b.name, 'ko'));
  people.forEach((p) => {
    rows[p.uid] ||= { pay: {}, ded: {}, status: '작성중' };
    rows[p.uid].pay ||= {}; rows[p.uid].ded ||= {};
  });
  const detail = sub?.detail ?? false;
  const warn = sub?.warn || '';
  let dirty = !!sub?.imported;

  const inp = (uid, grp, k, cls = '') => `<td class="${cls}"><input class="pin" data-u="${uid}" data-g="${grp}" data-k="${k}" inputmode="numeric" value="${num(rows[uid][grp]?.[k] ?? rows[uid][k]) ? comma(num(rows[uid][grp]?.[k] ?? rows[uid][k])) : ''}" placeholder="0"></td>`;
  const anyHidden = Object.values(rows).some((r) => hiddenPay(r));
  const payCols = detail ? PAY_ITEMS : ['기본급'];
  const dedCols = detail ? DED_ITEMS : [];
  shell(`
    <div class="row between"><div><p class="eyebrow">PAYROLL</p><h1>급여 관리</h1></div>
      <div class="row"><button id="prev" class="ghost">◀</button><div class="monthBox"><b>${monthTitle(month)} 급여</b>
        <label class="sm">지급일 <input type="date" id="payDate" value="${payDate}"></label></div><button id="next" class="ghost">▶</button></div></div>
    ${warn ? `<div class="card warn sm">${warn}</div>` : ''}
    ${!snap.exists() && !sub?.imported ? `<div class="card sm muted">${monthTitle(month)} 급여는 아직 입력되지 않았어요. 세무 급여대장 엑셀을 올리거나 칸에 직접 입력해 주세요.</div>` : ''}
    <div class="row between toolbar">
      <div class="row">
        <label class="upload primary">📤 세무 급여대장 엑셀 올리기<input type="file" id="xls" accept=".xlsx,.xls" hidden></label>
        <button id="copyPrev" class="ghost sm">📋 전월 불러오기</button>
        ${snap.exists() ? '<button id="delMonth" class="ghost sm danger">🗑️ 이 달 전체 삭제</button>' : ''}
        <button id="detail" class="ghost sm">${detail ? '🙈 항목 간단히' : '👁 항목 자세히 보기'}</button>
      </div>
      <label class="sm row">산재 요율 <input id="accRate" type="number" step="0.01" min="0" value="${accRate || ''}" placeholder="예: 0.7" style="width:5rem;flex:none">%</label>
      <label class="sm row">전체 상태 <select id="allStatus" style="width:auto;flex:none"><option value="">선택</option><option>작성중</option><option>확정</option><option>지급완료</option></select></label>
    </div>
    <div class="pay"><table>
      <thead>
        <tr><th rowspan="2">순번</th><th rowspan="2" class="nm">직원명</th><th rowspan="2">팀</th><th rowspan="2">직위</th>
          <th rowspan="2" class="hl">총 인건비<br><small>(지급+퇴직+지원)</small></th><th rowspan="2">실수령액</th>
          <th colspan="${payCols.length + 1 + (detail && anyHidden ? 1 : 0)}" class="ga">지급 항목</th><th colspan="${dedCols.length + 1}" class="gb">공제 항목</th>
          <th class="gc">퇴직</th><th class="gd">지원</th><th rowspan="2">메모</th><th rowspan="2">상태</th></tr>
        <tr>${payCols.map((t) => `<th>${t}</th>`).join('')}${detail && anyHidden ? '<th title="여름휴가비·직책수당·월차수당·자가운전보조금·야간근로수당">그 외</th>' : ''}<th class="ga">지급 계</th>${dedCols.map((t) => `<th>${t}</th>`).join('')}<th class="gb">공제 계</th>
          <th class="gc">월급여÷12</th><th class="gd">4대보험 회사분</th></tr>
      </thead>
      <tbody>
        ${people.map((p, i) => `<tr data-row="${p.uid}">
          <td>${i + 1}</td><td class="nm"><a href="#" data-slip="${p.uid}" title="명세서 미리보기"><b>${esc(p.name)}</b></a>${p.status === 'roster' ? ' <span class="tag gray">미가입</span>' : ''}${(p.work === '퇴사' || rows[p.uid].quitDate) ? ' <span class="tag gray">퇴사</span>' : ''}</td>
          <td>${p.team ? `<span class="tag">${esc(p.team)}</span>` : '-'}</td><td>${esc(rows[p.uid].job || p.job || ROLES[p.role] || '')}</td>
          <td class="hl" data-t="cost"></td><td data-t="net"></td>
          ${payCols.map((k) => inp(p.uid, 'pay', k)).join('')}${detail && anyHidden ? `<td>${hiddenPay(rows[p.uid]) ? comma(hiddenPay(rows[p.uid])) : ''}</td>` : ''}<td class="ga" data-t="pay"></td>
          ${dedCols.map((k) => inp(p.uid, 'ded', k)).join('')}<td class="gb" data-t="ded"></td>
          <td class="gc" data-t="retire"></td><td class="gd" data-t="support"></td>
          <td><input class="pin memo" data-u="${p.uid}" data-g="" data-k="memo" value="${esc(rows[p.uid].memo || '')}"></td>
          <td><select data-u="${p.uid}" data-g="" data-k="status" class="st">${['작성중', '확정', '지급완료'].map((s) => `<option ${rows[p.uid].status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="4">합계 (${people.length}명)</td><td class="hl" data-f="cost"></td><td data-f="net"></td>
        ${payCols.map((k) => `<td data-f="p_${k}"></td>`).join('')}${detail && anyHidden ? '<td></td>' : ''}<td class="ga" data-f="pay"></td>${dedCols.map((k) => `<td data-f="d_${k}"></td>`).join('')}<td class="gb" data-f="ded"></td>
        <td class="gc" data-f="retire"></td><td class="gd" data-f="support"></td><td colspan="2"></td></tr></tfoot>
    </table></div>
    <div class="kpis">
      <div class="kpi big"><span>${monthTitle(month)} 총 인건비</span><b class="accent" id="fCost"></b></div>
      <div class="kpi"><span>지급 총액</span><b id="fPay"></b></div>
      <div class="kpi"><span>실수령 총액</span><b id="fNet"></b></div>
      <div class="kpi"><span>1인 평균 인건비</span><b id="fAvg"></b></div>
    </div>
    <div class="card sm" id="insSum"></div>
    <div class="row"><button id="savePay" class="primary">저장</button><span class="muted sm" id="dirty">${dirty ? '엑셀 내용을 불러왔어요. 확인 후 저장을 눌러 주세요.' : ''}</span></div>
    <p class="muted sm">· 상태가 <b>확정</b> 또는 <b>지급완료</b>인 직원은 저장하면 본인 계정의 <b>급여명세서</b>에 바로 보여요.<br>
      · 총 인건비 = 지급 계 + <b>퇴직연금(세전 월급여÷12, 자동)</b> + <b>4대보험 회사 부담분(자동)</b>. 퇴직연금은 직원 명부에 연봉(세전 월급여)이 있어야 계산돼요.<br>
      · 4대보험 회사분 = 국민연금·건강보험·장기요양은 직원 공제액과 같은 금액, 고용보험은 직원분×1.15/0.9, 산재보험은 (지급액−식대)×산재 요율. 숫자에 마우스를 올리면 항목별 금액이 보여요.<br>
      · 직원 이름을 누르면 명세서를 미리 볼 수 있어요.</p>`);

  const recalc = () => {
    const t = { cost: 0, net: 0, pay: 0, ded: 0, retire: 0, support: 0 };
    people.forEach((p) => {
      const r = rows[p.uid], tr = $app.querySelector(`tr[data-row="${p.uid}"]`);
      const er = employerOf(r, accRate);
      r.retire = retireOf(p.uid); r.support = er.total;
      tr.querySelector('[data-t=retire]').textContent = r.retire ? comma(r.retire) : '-';
      const sc = tr.querySelector('[data-t=support]'); sc.textContent = comma(er.total);
      sc.title = Object.entries(er).filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${comma(v)}`).join('\n');
      tr.querySelector('[data-t=pay]').textContent = comma(payOf(r));
      tr.querySelector('[data-t=ded]').textContent = comma(dedOf(r));
      tr.querySelector('[data-t=net]').textContent = comma(netOf(r));
      tr.querySelector('[data-t=cost]').textContent = comma(costOf(r));
      t.cost += costOf(r); t.net += netOf(r); t.pay += payOf(r); t.ded += dedOf(r); t.retire += num(r.retire); t.support += num(r.support);
      payCols.forEach((k) => t['p_' + k] = (t['p_' + k] || 0) + num(r.pay[k]));
      dedCols.forEach((k) => t['d_' + k] = (t['d_' + k] || 0) + num(r.ded[k]));
    });
    Object.entries(t).forEach(([k, v]) => { const el = $app.querySelector(`[data-f="${k}"]`); if (el) el.textContent = comma(v); });
    const ins = { hl: 0, pen: 0, emp: 0, acc: 0 };
    people.forEach((p) => { const r = rows[p.uid], d = r.ded || {}, er = employerOf(r, accRate);
      ins.hl += num(d['건강보험']) + num(d['장기요양보험']) + er['건강보험'] + er['장기요양보험'];
      ins.pen += num(d['국민연금']) + er['국민연금']; ins.emp += num(d['고용보험']) + er['고용보험']; ins.acc += er['산재보험']; });
    document.getElementById('insSum').innerHTML = `<b>이번 달 4대보험 예상 납부액 (직원분 + 회사분, 직원 급여 기준)</b><br>
      건강보험+장기요양 <b>${comma(ins.hl)}원</b> · 국민연금 <b>${comma(ins.pen)}원</b> · 고용보험 <b>${comma(ins.emp)}원</b>${accRate ? ` · 산재보험 <b>${comma(ins.acc)}원</b>` : ' · 산재보험은 요율을 넣으면 계산돼요'}
      <br><span class="muted">대표원장님 본인 보험료(전액 본인 부담)는 직원 급여대장에 없어서 여기에는 빠져 있어요. 실제 고지서 금액과 비교할 때 참고해 주세요.</span>`;
    document.getElementById('fCost').textContent = comma(t.cost) + '원';
    document.getElementById('fPay').textContent = comma(t.pay) + '원';
    document.getElementById('fNet').textContent = comma(t.net) + '원';
    document.getElementById('fAvg').textContent = people.length ? comma(t.cost / people.length) + '원' : '-';
  };
  const mark = () => { dirty = true; document.getElementById('dirty').textContent = '저장 안 된 변경 있음'; };
  $app.querySelectorAll('.pin, .st').forEach((el) => {
    const { u, g, k } = el.dataset;
    const text = el.classList.contains('memo') || el.classList.contains('st');
    el.oninput = () => { const v = text ? el.value : num(el.value); if (g) rows[u][g][k] = v; else rows[u][k] = v; mark(); recalc(); };
    if (!text) {
      el.onfocus = () => { el.value = num(el.value) || ''; el.select(); };
      el.onblur = () => { el.value = num(el.value) ? comma(num(el.value)) : ''; };
    }
  });
  recalc();
  document.getElementById('payDate').oninput = (e) => { payDate = e.target.value; mark(); };
  document.getElementById('accRate').onchange = async (e) => {
    accRate = Number(e.target.value) || 0; recalc();
    await setDoc(doc(db, 'settings', 'payrollConf'), { accRate, updatedAt: serverTimestamp() }); toast('산재 요율을 저장했어요');
  };
  const leave = (fn) => () => { if (dirty && !confirm('저장하지 않은 변경이 있어요. 이동할까요?')) return; fn(); };
  document.getElementById('prev').onclick = leave(() => go('payroll', { month: shift(-1), detail }));
  document.getElementById('next').onclick = leave(() => go('payroll', { month: shift(1), detail }));
  document.getElementById('detail').onclick = leave(() => go('payroll', { month, detail: !detail }));
  document.getElementById('allStatus').onchange = (e) => {
    if (!e.target.value) return;
    people.forEach((p) => rows[p.uid].status = e.target.value);
    $app.querySelectorAll('.st').forEach((s) => s.value = e.target.value); mark();
  };
  $app.querySelectorAll('[data-slip]').forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    const p = people.find((x) => x.uid === a.dataset.slip);
    const w = document.createElement('div'); w.className = 'modal';
    w.innerHTML = `<div class="modalBox">${slipHtml(slipData(month, payDate, p, rows[p.uid]))}<div class="row"><button class="primary" id="closeM">닫기</button></div></div>`;
    document.body.appendChild(w); w.onclick = (ev) => { if (ev.target === w || ev.target.id === 'closeM') w.remove(); };
  });
  document.getElementById('delMonth')?.addEventListener('click', async () => {
    if (!confirm(`${monthTitle(month)} 급여 내용을 모두 지울까요?\n직원들에게 공개된 이 달 급여명세서도 함께 지워지고, 되돌릴 수 없어요.`)) return;
    const slips = await getDocs(collection(db, 'payslips'));
    for (const d of slips.docs) if (d.id.startsWith(month + '_')) await deleteDoc(d.ref);
    await deleteDoc(ref);
    toast('삭제했어요'); go('payroll', { month, detail });
  });
  document.getElementById('copyPrev').onclick = async () => {
    const p = await getDoc(doc(db, 'payroll', shift(-1)));
    if (!p.exists()) return toast('전월 급여 기록이 없어요');
    if (!confirm('전월 금액으로 이번 달 표를 채울까요? (저장 전까지는 반영되지 않아요)')) return;
    const prev = p.data().rows || {};
    const imported = { rows: {}, payDate };
    Object.entries(prev).forEach(([id, r]) => { imported.rows[id] = { ...JSON.parse(JSON.stringify(r)), status: '작성중' }; });
    go('payroll', { month, detail, imported });
  };
  document.getElementById('xls').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    let data;
    try { data = await parsePayrollExcel(file); } catch (err) { console.error(err); return alert(err.message || '엑셀을 읽지 못했어요.'); }
    const target = data.month || month;
    if (data.month && data.month !== month && !confirm(`엑셀은 ${monthTitle(data.month)} 급여대장이에요. ${monthTitle(data.month)} 급여로 넣을까요?`)) return;
    const msgs = [];
    // 이름으로 직원 찾기, 없으면 명부(미가입)로 추가
    const missing = data.people.filter((x) => !all.some((p) => p.name === x.name && p.status !== 'rejected'));
    if (missing.length && confirm(`직원 명부에 없는 이름이 ${missing.length}명 있어요: ${missing.map((x) => x.name).join(', ')}\n명부에 추가할까요? (취소하면 이 사람들은 건너뛰어요)`)) {
      for (const x of missing) {
        const r = await addDoc(collection(db, 'users'), { name: x.name, job: x.job, dept: x.dept, team: '', role: 'staff', phone: '', email: '',
          hireDate: x.hireDate, work: x.quitDate ? '퇴사' : '재직', annualAdjust: 0, status: 'roster', createdAt: serverTimestamp() });
        all.push({ uid: r.id, name: x.name, status: 'roster', role: 'staff', hireDate: x.hireDate });
      }
      msgs.push(`명부에 ${missing.length}명을 새로 추가했어요.`);
    }
    const imported = { rows: {}, payDate: data.payDate };
    const prevRows = target === month ? rows : ((await getDoc(doc(db, 'payroll', target))).data()?.rows || {});
    const filled = [];
    for (const x of data.people) {
      const p = all.find((q) => q.name === x.name && q.status !== 'rejected');
      if (!p) continue;
      const old = prevRows[p.uid] || {};
      imported.rows[p.uid] = { pay: x.pay, ded: x.ded, memo: old.memo || '', status: '확정',
        name: x.name, job: x.job, dept: x.dept, hireDate: x.hireDate, quitDate: x.quitDate };
      const calc = imported.rows[p.uid];
      if (x.fileNet && Math.abs(netOf(calc) - x.fileNet) > 1) msgs.push(`⚠️ ${x.name}: 엑셀 실수령액(${comma(x.fileNet)})과 계산값(${comma(netOf(calc))})이 달라요. 확인해 주세요.`);
      if (!p.hireDate && x.hireDate && p.status) { await updateDoc(doc(db, 'users', p.uid), { hireDate: x.hireDate }); filled.push(x.name); }
    }
    if (filled.length) msgs.push(`입사일이 비어 있던 ${filled.join(', ')}의 입사일을 엑셀 기준으로 넣었어요.`);
    msgs.unshift(`📤 ${monthTitle(target)} 급여대장에서 ${Object.keys(imported.rows).length}명을 불러왔어요. 확인 후 <b>저장</b>을 눌러 주세요.`);
    go('payroll', { month: target, detail: true, imported, warn: msgs.join('<br>') });
  };
  document.getElementById('savePay').onclick = async (ev) => {
    ev.target.disabled = true;
    const clean = {};
    people.forEach((p) => { clean[p.uid] = { ...rows[p.uid], name: p.name }; });
    await setDoc(ref, { rows: clean, payDate, updatedAt: serverTimestamp(), updatedBy: me.name });
    // 직원별 명세서 공개/회수
    let n = 0;
    for (const p of people) {
      const sref = doc(db, 'payslips', `${month}_${p.uid}`);
      if (['확정', '지급완료'].includes(clean[p.uid].status)) { await setDoc(sref, slipData(month, payDate, p, clean[p.uid])); n++; }
      else await deleteDoc(sref).catch(() => {});
    }
    dirty = false; document.getElementById('dirty').textContent = ''; ev.target.disabled = false;
    toast(`저장했어요 · 명세서 ${n}명 공개`);
  };
}

// ---------- 급여명세서 ----------
function slipData(month, payDate, p, r) {
  return {
    uid: p.uid, month, payDate: payDate || '', clinicName: theme.clinicName,
    name: p.name, dept: r.dept || p.dept || '', job: r.job || p.job || '', hireDate: r.hireDate || p.hireDate || '',
    pay: PAY_ALL.filter((k) => PAY_ITEMS.includes(k) || num(r.pay?.[k])).map((k) => [k, num(r.pay?.[k])]), ded: DED_ITEMS.map((k) => [k, num(r.ded?.[k])]),
    payTotal: payOf(r), dedTotal: dedOf(r), net: netOf(r)
  };
}
function slipHtml(s) {
  const n = Math.max(s.pay.length, s.ded.length);
  const v = (x) => x ? comma(x) : '';
  return `<div class="slip">
    <h2 class="slipTitle">${monthTitle(s.month)} 급상여명세서</h2>
    <div class="slipInfo">
      <div>회사명 : ${esc(s.clinicName)}</div><div>입사일 : ${esc(s.hireDate || '-')}</div>
      <div>성명 : <b>${esc(s.name)}</b></div><div>지급일 : ${esc(s.payDate || '-')}</div>
      <div>부서 : ${esc(s.dept || '')}</div><div>직위 : ${esc(s.job || '')}</div>
    </div>
    <table class="slipTbl">
      <tr><th colspan="4" class="cap">세부 내역</th></tr>
      <tr><th colspan="2">지 급</th><th colspan="2">공 제</th></tr>
      <tr><th>임금 항목</th><th>지급 금액</th><th>공제 항목</th><th>공제 금액</th></tr>
      ${Array.from({ length: n }, (_, i) => `<tr><td>${s.pay[i]?.[0] || ''}</td><td class="r">${v(s.pay[i]?.[1])}</td><td>${s.ded[i]?.[0] || ''}</td><td class="r">${v(s.ded[i]?.[1])}</td></tr>`).join('')}
      <tr class="sum"><th>지급액 계</th><td class="r">${comma(s.payTotal)}</td><th>공제액 계</th><td class="r">${comma(s.dedTotal)}</td></tr>
      <tr class="sum"><td colspan="2" class="blank"></td><th>실수령액</th><td class="r net">${comma(s.net)}</td></tr>
    </table>
    <p class="slipFoot">귀하의 노고에 감사드립니다.</p>
  </div>`;
}
async function renderMySlips() {
  const snap = await getDocs(query(collection(db, 'payslips'), where('uid', '==', me.uid)));
  const slips = snap.docs.map((d) => d.data()).sort((a, b) => b.month.localeCompare(a.month));
  const cur = slips.find((s) => s.month === sub?.month) || slips[0];
  shell(`
    <div class="row between noprint"><div><p class="eyebrow">PAYSLIP</p><h1>급여명세서</h1></div>
      ${slips.length ? `<div class="row"><select id="sm" style="width:auto;flex:none">${slips.map((s) => `<option value="${s.month}" ${s === cur ? 'selected' : ''}>${monthTitle(s.month)}</option>`).join('')}</select>
        <button id="print" class="ghost">🖨️ 인쇄 / PDF 저장</button></div>` : ''}</div>
    ${cur ? `<section class="card slipCard">${slipHtml(cur)}</section>` : '<section class="card"><p class="muted">아직 공개된 급여명세서가 없어요.</p></section>'}
    <p class="muted sm noprint">명세서는 본인과 관리자만 볼 수 있어요.</p>`);
  document.getElementById('sm')?.addEventListener('change', (e) => go('slips', { month: e.target.value }));
  document.getElementById('print')?.addEventListener('click', () => window.print());
}

// ---------- 근무표 (달력 / 표) ----------
// 우리 치과 근무표 형식: 그날 '연차' / '비번(주휴)' / '야간빠짐(월요일 야간 오프)' 인 사람을 표시
const LEGACY = { '휴무': '비번', '야간': '야간빠짐', '오전': '오전반차', '오후': '오후반차', '시간차': '반차' };
const codeOf = (c) => LEGACY[c] || c || '';
const LINES = [['연차', ['연차', '오전반차', '오후반차', '반차', ...LEAVE_KINDS.slice(3)]], ['비번', ['비번']], ['야간빠짐', ['야간빠짐']]];
const SUFFIX = { '오전반차': '(오전)', '오후반차': '(오후)', '반차': '(반)' };
const HOLIDAYS = {
  '2026-01-01': '신정', '2026-02-16': '설날', '2026-02-17': '설날', '2026-02-18': '설날', '2026-03-01': '삼일절', '2026-03-02': '대체공휴일',
  '2026-05-05': '어린이날', '2026-05-24': '부처님 오신 날', '2026-05-25': '대체공휴일', '2026-06-03': '지방선거', '2026-06-06': '현충일',
  '2026-08-15': '광복절', '2026-08-17': '대체공휴일', '2026-09-24': '추석', '2026-09-25': '추석', '2026-09-26': '추석', '2026-10-03': '개천절',
  '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
  '2027-01-01': '신정', '2027-02-06': '설날', '2027-02-07': '설날', '2027-02-08': '설날', '2027-02-09': '설날 대체공휴일', '2027-03-01': '삼일절',
  '2027-05-01': '근로자의 날', '2027-05-03': '근로자의 날 대체공휴일', '2027-05-05': '어린이날', '2027-05-13': '부처님 오신 날', '2027-06-06': '현충일',
  '2027-07-17': '제헌절', '2027-07-19': '제헌절 대체공휴일', '2027-08-15': '광복절', '2027-08-16': '광복절 대체공휴일', '2027-09-14': '추석',
  '2027-09-15': '추석', '2027-09-16': '추석', '2027-10-03': '개천절', '2027-10-04': '개천절 대체공휴일', '2027-10-09': '한글날',
  '2027-10-11': '한글날 대체공휴일', '2027-12-25': '성탄절', '2027-12-27': '성탄절 대체공휴일'
};

async function renderSchedule() {
  const now = new Date();
  const month = sub?.month || `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const mode = sub?.mode || 'cal';
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const ref = doc(db, 'schedules', month);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : { people: [], cells: {}, holidays: {} };
  data.cells ||= {}; data.people ||= []; data.holidays ||= {};
  Object.values(data.cells).forEach((c) => Object.keys(c).forEach((d) => { c[d] = codeOf(c[d]); }));
  const editor = canApprove();
  const org = await loadOrg();
  const order = orgOrder(org);
  let seeded = false;
  if (editor) {   // 재직자로 명단 맞추기
    const act = (await loadPeople()).filter((p) => ['active', 'roster'].includes(p.status) && (p.work || '재직') !== '퇴사');
    act.forEach((p) => { const o = data.people.find((x) => x.uid === p.uid); if (o) { o.name = p.name; o.team = p.team || ''; } else data.people.push({ uid: p.uid, name: p.name, team: p.team || '' }); });
    data.people = data.people.filter((x) => act.some((p) => p.uid === x.uid) || Object.keys(data.cells[x.uid] || {}).length);
  }
  // 조직도 순서로 정렬 + 그룹
  const rank = (name) => { const i = order.findIndex((o) => o.name === name); return i < 0 ? 999 : i; };
  const groupOf = (name) => order.find((o) => o.name === name) || { group: '기타', doctor: false, gi: 999 };
  // 진료팀 고년차/저년차 색: 조직도의 직급으로 정해요 (팀장·시니어 = 고년차, 주니어·엔트리 = 저년차)
  const titleOf = {}, colorOf = {}; (org.groups || []).forEach((g) => (g.members || []).forEach((m) => { titleOf[m.name] = m.title || ''; colorOf[m.name] = m.color || ''; }));
  const anyColor = Object.values(colorOf).some(Boolean);
  const tierOf = (name) => colorOf[name] ? 'pc pc-' + colorOf[name]
    : anyColor ? '' : /팀장|시니어|고년차/.test(titleOf[name] || '') ? 't-senior' : /주니어|엔트리|저년차|신입/.test(titleOf[name] || '') ? 't-junior' : '';
  data.people.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'ko'));
  const shift = (k) => { const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const hol = (d) => data.holidays[d] || HOLIDAYS[`${month}-${pad(d)}`] || '';
  const nameOf = (uid) => data.people.find((p) => p.uid === uid)?.name || '';
  const saveAll = async () => { await setDoc(ref, { people: data.people, cells: data.cells, holidays: data.holidays, updatedAt: serverTimestamp(), updatedBy: me.name }); };

  const head = `
    <div class="row between"><div><p class="eyebrow">SCHEDULE</p><h1>근무표</h1></div>
      <div class="chips seg2"><button data-mode="cal" class="${mode === 'cal' ? 'on' : ''}">📅 달력</button><button data-mode="table" class="${mode === 'table' ? 'on' : ''}">📋 표</button></div></div>
    <div class="row between month"><button id="prev" class="ghost">◀</button><b>${y}년 ${m}월</b><button id="next" class="ghost">▶</button></div>
    ${seeded ? `<div class="card warn sm row between"><span>📥 근무표2027 시트에 입력돼 있던 ${y}년 ${m}월 내용을 불러왔어요. 확인 후 저장해 주세요.</span><button id="saveSeed" class="primary sm">저장</button></div>` : ''}`;

  if (mode === 'cal') {
    const first = new Date(y, m - 1, 1).getDay();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= last; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);
    const dayHtml = (d) => {
      if (!d) return '<td class="cd out"></td>';
      const dw = new Date(y, m - 1, d).getDay(), h = hol(d);
      const lines = LINES.map(([label, codes]) => {
        const ns = data.people.filter((p) => codes.includes(codeOf(data.cells[p.uid]?.[d])));
        if (!ns.length) return '';
        return `<div class="ln l-${label}"><span>${label}</span>${ns.map((p) => { const c = codeOf(data.cells[p.uid][d]); return `<em class="${p.uid === me.uid ? 'mine' : ''} ${tierOf(p.name)}">${esc(p.name)}${SUFFIX[c] || (c !== '연차' ? `(${esc(c)})` : '')}</em>`; }).join('')}</div>`;
      }).join('');
      return `<td class="cd ${dw === 0 ? 'sun' : dw === 6 ? 'sat' : ''} ${h ? 'hol' : ''} ${editor ? 'edit' : ''}" data-day="${d}">
        <div class="dn"><b>${d}</b>${h ? `<small>${esc(h)}</small>` : ''}</div>${dw === 0 && !lines ? '<div class="muted sm closed">휴진</div>' : lines}</td>`;
    };
    shell(`${head}
      <div class="calWrap"><table class="cal"><tr>${'일월화수목금토'.split('').map((w, i) => `<th class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</th>`).join('')}</tr>
        ${Array.from({ length: cells.length / 7 }, (_, w) => `<tr>${cells.slice(w * 7, w * 7 + 7).map(dayHtml).join('')}</tr>`).join('')}</table></div>
      <div class="legend sm"><span class="ln l-연차"><span>연차</span></span> (오전)=오전반차 0.4일 (오후)=오후반차 0.6일 <span class="ln l-비번"><span>비번</span></span> 주휴 <span class="ln l-야간빠짐"><span>야간빠짐</span></span> 월요일 야간 오프 · ${anyColor ? '이름 색은 조직도에서 정한 업무 그룹 색이에요' : '<em class="t-senior">고년차</em> <em class="t-junior">저년차</em>'}
        ${editor ? ' · <b>날짜를 누르면 쉬는 사람을 넣을 수 있어요.</b>' : ''}</div>`);
  } else {
    let stamp = sub?.stamp ?? '비번';
    const DOW = '일월화수목금토';
    const STAMPS2 = [['', '근무'], ['비번', '비번'], ['연차', '연차'], ['오전반차', '오전반차'], ['오후반차', '오후반차'], ['야간빠짐', '야간빠짐']];
    const SHORT = { '야간빠짐': '야간', '오전반차': '오전', '오후반차': '오후' };
    const cellHtml = (uid, d) => { const c = codeOf(data.cells[uid]?.[d]); return `<td data-u="${uid}" data-d="${d}" title="${esc(c)}" class="c ${c ? (['비번', '연차', '오전반차', '오후반차', '야간빠짐', '반차'].includes(c) ? 'k-' + c : 'k-etc') : ''} ${new Date(y, m - 1, d).getDay() === 0 ? 'sun' : ''} ${hol(d) ? 'hol' : ''}">${SHORT[c] || (c.length > 3 ? c.slice(0, 2) : c)}</td>`; };
    let lastG = null;
    const rows = data.people.map((p) => {
      const g = groupOf(p.name);
      const sep = g.group !== lastG ? `<tr class="grp ${g.doctor ? 'doc' : ''}"><th class="nm" colspan="${last + 1}">${esc(g.group)}</th></tr>` : '';
      lastG = g.group;
      return sep + `<tr class="${p.uid === me.uid ? 'mine' : ''}"><th class="nm"><span class="${tierOf(p.name)}">${esc(p.name)}</span></th>${Array.from({ length: last }, (_, i) => cellHtml(p.uid, i + 1)).join('')}</tr>`;
    }).join('');
    shell(`${head}
      ${editor ? `<div class="chips stamps">${STAMPS2.map(([k, t]) => `<button data-s="${k}" class="${stamp === k ? 'on' : ''} ${k ? 'k-' + k : ''}">${t}</button>`).join('')}</div>
        <p class="muted sm">도장을 고르고 칸을 누르세요. 빈칸은 정상 근무예요.</p>` : ''}
      <div class="sched"><table>
        <tr><th class="nm">이름</th>${Array.from({ length: last }, (_, i) => { const dw = new Date(y, m - 1, i + 1).getDay(); return `<th class="${dw === 0 || hol(i + 1) ? 'sun' : dw === 6 ? 'sat' : ''}" title="${esc(hol(i + 1))}">${i + 1}<br><small>${DOW[dw]}</small></th>`; }).join('')}</tr>
        ${rows || `<tr><td class="muted" colspan="${last + 1}">아직 근무표가 없어요.</td></tr>`}
      </table></div>
      ${editor ? '<div class="row"><button id="saveSched" class="primary">근무표 저장</button><span class="muted sm" id="dirty"></span></div>' : ''}`);
    if (editor) {
      $app.querySelectorAll('.stamps button').forEach((b) => b.onclick = () => { stamp = b.dataset.s; $app.querySelectorAll('.stamps button').forEach((x) => x.classList.toggle('on', x === b)); });
      const bindCell = (td) => td.onclick = () => {
        const { u, d } = td.dataset;
        data.cells[u] ||= {};
        const next = codeOf(data.cells[u][d]) === stamp ? '' : stamp;
        if (next) data.cells[u][d] = next; else delete data.cells[u][d];
        td.outerHTML = cellHtml(u, Number(d));
        bindCell($app.querySelector(`td[data-u="${u}"][data-d="${d}"]`));
        document.getElementById('dirty').textContent = '저장 안 된 변경 있음';
      };
      $app.querySelectorAll('td.c').forEach(bindCell);
      document.getElementById('saveSched').onclick = async () => { await saveAll(); toast('근무표를 저장했어요'); document.getElementById('dirty').textContent = ''; };
    }
  }

  // 공통 버튼
  const cur = { month, mode };
  $app.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => go('work', { tab: 'schedule', month, mode: b.dataset.mode }));
  document.getElementById('prev').onclick = () => go('work', { tab: 'schedule', ...cur, month: shift(-1) });
  document.getElementById('next').onclick = () => go('work', { tab: 'schedule', ...cur, month: shift(1) });
  document.getElementById('saveSeed')?.addEventListener('click', async () => { await saveAll(); toast('저장했어요'); go('work', { tab: 'schedule', ...cur }); });

  // 달력에서 날짜 누르면 편집 창
  if (editor && mode === 'cal') $app.querySelectorAll('td.cd[data-day]').forEach((td) => td.onclick = () => {
    const d = Number(td.dataset.day);
    const dw = '일월화수목금토'[new Date(y, m - 1, d).getDay()];
    const sel = {};   // uid → code
    data.people.forEach((p) => { const c = codeOf(data.cells[p.uid]?.[d]); if (c) sel[p.uid] = c; });
    const w = document.createElement('div'); w.className = 'modal';
    const groups = [];
    data.people.forEach((p) => { const g = groupOf(p.name).group; let x = groups.find((q) => q.g === g); if (!x) groups.push(x = { g, ps: [] }); x.ps.push(p); });
    const drawM = () => {
      w.innerHTML = `<div class="modalBox">
        <h2>${m}월 ${d}일 (${dw})</h2>
        <label class="sm">휴일 이름 (비우면 기본 공휴일)<input id="holName" value="${esc(data.holidays[d] || '')}" placeholder="${esc(HOLIDAYS[`${month}-${pad(d)}`] || '예: 원내 휴진, 여름휴가')}"></label>
        ${[['연차', '연차 (종일)'], ['오전반차', '오전반차 (0.4일)'], ['오후반차', '오후반차 (0.6일)'], ['비번', '비번 (주휴)'], ['야간빠짐', '야간빠짐 (월요일 야간 오프)']].map(([code, label]) => `
          <div class="pick"><b class="ln l-${LINES.find((l) => l[1].includes(code))[0]}"><span>${label}</span></b>
            <div class="pickG">${groups.map((g) => `<div><small class="muted">${esc(g.g)}</small>${g.ps.map((p) => `<button data-p="${p.uid}" data-c="${code}" class="chip ${tierOf(p.name)} ${sel[p.uid] === code ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>`).join('')}</div></div>`).join('')}
        <div class="row"><button id="applyM" class="primary">저장</button><button id="closeM" class="ghost">닫기</button></div></div>`;
      w.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { const { p, c } = b.dataset; sel[p] = sel[p] === c ? undefined : c; const hv = w.querySelector('#holName').value; drawM(); w.querySelector('#holName').value = hv; });
      w.querySelector('#closeM').onclick = () => w.remove();
      w.querySelector('#applyM').onclick = async () => {
        data.people.forEach((p) => { data.cells[p.uid] ||= {}; if (sel[p.uid]) data.cells[p.uid][d] = sel[p.uid]; else delete data.cells[p.uid][d]; });
        const hn = w.querySelector('#holName').value.trim(); if (hn) data.holidays[d] = hn; else delete data.holidays[d];
        await saveAll(); w.remove(); toast('저장했어요'); go('work', { tab: 'schedule', ...cur });
      };
    };
    drawM(); document.body.appendChild(w);
    w.onclick = (ev) => { if (ev.target === w) w.remove(); };
  });
}

// ---------- 조직도 ----------
// 직원 이름 등 개인 정보는 코드에 넣지 않음 — 관리자가 입력하거나 올린 파일 내용만 Firebase(로그인 필요)에 저장
const DEFAULT_ORG = { groups: [{ name: '원장', doctor: true, members: [] }] };
async function loadOrg() {
  const d = await getDoc(doc(db, 'org', 'main'));
  return withTree(d.exists() ? d.data() : JSON.parse(JSON.stringify(DEFAULT_ORG)));
}
// 부서마다 id와 상위 부서(parent) 정하기. 처음엔: 원장 → 경영지원/총괄 → 나머지 부서
function withTree(org) {
  const g = org.groups || (org.groups = []);
  g.forEach((x) => { x.id ||= 'g' + Math.random().toString(36).slice(2, 8); });
  if (g.length && !g.some((x) => 'parent' in x)) {
    const top = g.find((x) => x.doctor) || g[0];
    const mid = g.find((x) => x !== top && /경영|총괄/.test(x.name));
    g.forEach((x) => { x.parent = x === top ? '' : x === mid ? top.id : (mid || top).id; });
  }
  g.forEach((x) => { if (x.parent && !g.some((y) => y.id === x.parent)) x.parent = ''; });
  return org;
}
// 근무표에서 쓰는 사람별 색 (조직도 편집에서 고름)
const PCOLORS = { green: '초록', red: '빨강', orange: '주황', yellow: '노랑', lime: '연두', purple: '보라', blue: '파랑', pink: '분홍', gray: '회색' };
// 트리 구조 도우미: 첫 번째 최상위 부서가 가운데(맨 위), 나머지 최상위 부서와 '옆' 부서는 그 옆에 붙여 표시
function orgTree(org) {
  const g = org.groups || [];
  const main = g.find((x) => !x.parent);
  const kids = (id) => g.filter((x) => x.parent === id && !x.side);
  const sides = (id) => [...g.filter((x) => x.parent === id && x.side), ...(main && id === main.id ? g.filter((x) => !x.parent && x !== main) : [])];
  return { g, main, kids, sides };
}
// 트리 순서(위→아래, 왼→오)로 부서 나열 — 옆 부서는 기준 부서 바로 다음
function orgTreeList(org) {
  const { g, main, kids, sides } = orgTree(org), out = [];
  const visit = (x, depth, side) => { if (out.some((o) => o.g === x)) return; out.push({ g: x, depth, side }); sides(x.id).forEach((s2) => visit(s2, depth, true)); kids(x.id).forEach((c) => visit(c, depth + 1, false)); };
  if (main) visit(main, 0, false);
  g.forEach((x) => { if (!out.some((o) => o.g === x)) out.push({ g: x, depth: 0, side: true }); });
  return out;
}
// 근무표·명단 순서: 조직도 트리 순서 그대로 (맨 위 가운데 부서 = 원장진)
function orgOrder(org) {
  const out = [];
  orgTreeList(withTree(org)).forEach(({ g, depth, side }, gi) => (g.members || []).forEach((m) => out.push({ name: m.name, group: g.name, doctor: depth === 0 && !side, gi })));
  return out;
}

// 조직도·근무표·연차 규칙 자료 파일(.json) 불러오기 — 직원 정보는 코드가 아니라 로그인해야 볼 수 있는 Firebase에만 저장
async function importInitFile(file) {
  if (!file) return;
  let init;
  try { init = JSON.parse(await file.text()); } catch { return alert('파일을 읽지 못했어요.'); }
  if (init.type !== 'plaire-portal-init') return alert('직원포털 자료 파일이 아니에요.');
  if (!init.org && init.colors) {   // 색만 바꾸는 파일: 지금 조직도는 그대로 두고 이름별 색만 넣기
    const org = await loadOrg(); let n = 0;
    org.groups.forEach((g) => (g.members || []).forEach((m) => { if (init.colors[m.name] !== undefined) { m.color = init.colors[m.name]; n++; } }));
    if (!confirm(`조직도는 그대로 두고 ${n}명의 근무표 색만 바꿀까요?`)) return;
    await setDoc(doc(db, 'org', 'main'), { groups: org.groups, updatedAt: serverTimestamp(), updatedBy: me.name });
    toast(`${n}명 색을 바꿨어요`); return go('org');
  }
  const months = Object.keys(init.schedules || {});
  if (!confirm(`이 파일로 다음을 채울까요?\n· 조직도 ${orgOrder(init.org).length}명\n· 근무표 ${months.length}개월 (${months.join(', ')})${init.leaveRules ? '\n· 연차 사용 규칙 (비어 있을 때만)' : ''}\n\n지금 조직도는 파일 내용으로 바뀌어요.`)) return;
  let people = await loadPeople();
  const missing = orgOrder(init.org).filter((x) => !people.some((p) => p.name === x.name && p.status !== 'rejected'));
  for (const x of missing) {
    const grp = init.org.groups.find((g) => g.name === x.group); const m = grp.members.find((y) => y.name === x.name);
    await addDoc(collection(db, 'users'), { name: x.name, job: m.title || '', dept: grp.name, team: /팀/.test(grp.name) ? grp.name : '', role: grp.doctor ? 'doctor' : 'staff',
      phone: '', email: '', hireDate: '', work: '재직', annualAdjust: 0, status: 'roster', createdAt: serverTimestamp() });
  }
  if (missing.length) people = await loadPeople();
  await setDoc(doc(db, 'org', 'main'), { groups: withTree(init.org).groups, updatedAt: serverTimestamp(), updatedBy: me.name });
  for (const month of months) {
    const ref = doc(db, 'schedules', month);
    const cur = (await getDoc(ref)).data() || { people: [], cells: {}, holidays: {} };
    cur.people ||= []; cur.cells ||= {}; cur.holidays ||= {};
    Object.entries(init.schedules[month]).forEach(([name, days]) => {
      const p = people.find((x) => x.name === name && x.status !== 'rejected'); if (!p) return;
      if (!cur.people.some((x) => x.uid === p.uid)) cur.people.push({ uid: p.uid, name: p.name, team: p.team || '' });
      cur.cells[p.uid] = { ...(cur.cells[p.uid] || {}), ...days };
    });
    await setDoc(ref, cur);
  }
  if (init.leaveRules && !(await getDoc(doc(db, 'settings', 'leaveRules'))).exists())
    await setDoc(doc(db, 'settings', 'leaveRules'), { text: init.leaveRules, updatedAt: serverTimestamp(), updatedBy: me.name });
  toast(`불러왔어요${missing.length ? ` · 명부에 ${missing.length}명 추가` : ''}`); go('org');
}

async function renderOrg() {
  const org = await loadOrg();
  const editing = sub?.edit && can.editManual();
  const total = (org.groups || []).reduce((s, g) => s + (g.members || []).length, 0);
  if (!editing) {
    const person = (m) => `<div class="op"><div><b>${esc(m.name)}</b>${m.title ? `<span class="tag">${esc(m.title)}</span>` : ''}</div>
      ${m.rr ? `<p>${esc(m.rr)}</p>` : ''}${m.duty ? `<p class="muted">🔧 ${esc(m.duty)}</p>` : ''}${m.backup ? `<p class="muted">🤝 휴무 시 인계: ${esc(m.backup)}</p>` : ''}</div>`;
    const T = orgTree(org);
    const card = (g, cls) => `<div class="og ${cls}"><div class="ogh">${esc(g.name)} <small>${(g.members || []).length}명</small></div>${(g.members || []).map(person).join('')}</div>`;
    const node = (g, depth) => {
      const kids = T.kids(g.id), sides = T.sides(g.id);
      return `<li><div class="nodeBox">${card(g, depth === 0 ? 'doc' : '')}
          ${sides.length ? `<div class="sides">${sides.map((x) => `<span class="sideLine"></span>${card(x, 'side')}`).join('')}</div>` : ''}</div>
        ${kids.length ? `<ul>${kids.map((k) => node(k, depth + 1)).join('')}</ul>` : ''}</li>`;
    };
    const roots = T.main ? [T.main] : [];
    shell(`
      <div class="row between"><div><p class="eyebrow">ORGANIZATION</p><h1>조직도</h1><p class="muted sm">총 ${total}명 · 근무표에도 이 순서대로 보여요.</p></div>
        <div class="row">${me.role === 'admin' ? '<label class="upload ghostUp">📥 자료 파일 불러오기<input type="file" id="initFile" accept=".json" hidden></label>' : ''}
        ${can.editManual() ? '<button id="edit" class="primary">✏️ 조직도 편집</button>' : ''}</div></div>
      ${!total ? '<div class="card sm muted">아직 조직도가 비어 있어요. 관리자가 "자료 파일 불러오기"로 받은 파일을 올리거나 "조직도 편집"에서 직접 입력해 주세요.</div>' : ''}
      <div class="tree"><ul>${roots.map((r) => node(r, 0)).join('')}</ul></div>`);
    document.getElementById('edit')?.addEventListener('click', () => go('org', { edit: true }));
    document.getElementById('initFile')?.addEventListener('change', (e) => importInitFile(e.target.files[0]));
    return;
  }

  const people = await loadPeople();
  const g = JSON.parse(JSON.stringify(org.groups || []));
  const descendants = (id) => { const out = []; const w = (p) => g.filter((x) => x.parent === p).forEach((x) => { out.push(x.id); w(x.id); }); w(id); return out; };
  const draw = () => {
    const list = orgTreeList({ groups: g });
    shell(`
      <div class="row between"><div><p class="eyebrow">ORGANIZATION</p><h1>조직도 편집</h1>
        <p class="muted sm">부서마다 <b>"어디 밑에 있나요?"</b>를 고르면 계층이 정해져요. 같은 상위 부서 밑에 있으면 같은 줄에 나란히 보여요.<br>"○○ 옆"을 고르면 그 부서 바로 옆에 붙어서 보여요 (예: 경영지원을 원장 옆에). 맨 위 부서가 여러 개면 두 번째부터는 첫 번째 옆에 붙어요.<br>↑↓는 같은 줄 안의 순서예요. 근무표 순서도 같이 바뀌어요.</p></div>
        <div class="row"><button id="cancel" class="ghost">취소</button><button id="saveOrg" class="primary">저장</button></div></div>
      <datalist id="names">${people.filter((p) => ['active', 'roster'].includes(p.status)).map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
      ${list.map(({ g: grp, depth, side }) => { const gi = g.indexOf(grp); const bad = [grp.id, ...descendants(grp.id)]; return `
        <div class="lvLine"><span>${depth + 1}단계${side ? ' · 옆' : ''}</span></div>
        <section class="card oe" style="margin-left:${Math.min(depth, 4) * 1.6}rem">
          <div class="row">
            <span class="depth">${'└'.repeat(depth ? 1 : 0)}</span>
            <input class="gname" data-g="${gi}" value="${esc(grp.name)}" placeholder="부서·팀 이름">
            <label class="sm row parentSel">어디 밑에 있나요?
              <select data-par="${gi}"><option value="">맨 위 (최상위)</option>${g.filter((x) => !bad.includes(x.id)).map((x) => `<option value="${x.id}" ${grp.parent === x.id && !grp.side ? 'selected' : ''}>${esc(x.name)} 밑</option><option value="side:${x.id}" ${grp.parent === x.id && grp.side ? 'selected' : ''}>${esc(x.name)} 옆 (나란히)</option>`).join('')}</select></label>
            <button data-gu="${gi}" class="ghost sm" title="같은 줄에서 앞으로">↑</button><button data-gd="${gi}" class="ghost sm" title="같은 줄에서 뒤로">↓</button>
            <button data-gx="${gi}" class="ghost sm danger">부서 삭제</button></div>
          <div class="tbl"><table class="oeT"><tr><th></th><th>이름</th><th>직급</th><th>근무표 색</th><th>R&R (역할)</th><th>담당 업무</th><th>휴무 시 인계</th><th></th></tr>
            ${(grp.members || []).map((m, mi) => `<tr>
              <td class="nowrap"><button data-mu="${gi}:${mi}" class="ghost sm">↑</button><button data-md="${gi}:${mi}" class="ghost sm">↓</button></td>
              ${['name', 'title'].map((k) => `<td><input data-m="${gi}:${mi}:${k}" value="${esc(m[k] || '')}" ${k === 'name' ? 'list="names"' : ''}></td>`).join('')}
              <td><select data-m="${gi}:${mi}:color" class="pcSel pc-${m.color || ''}"><option value="">없음</option>${Object.entries(PCOLORS).map(([k, t]) => `<option value="${k}" ${m.color === k ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
              ${['rr', 'duty', 'backup'].map((k) => `<td><input data-m="${gi}:${mi}:${k}" value="${esc(m[k] || '')}"></td>`).join('')}
              <td><button data-mx="${gi}:${mi}" class="ghost sm danger">✕</button></td></tr>`).join('')}
          </table></div>
          <div class="row"><button data-ma="${gi}" class="ghost sm">＋ 사람 추가</button><button data-sub="${gi}" class="ghost sm">＋ 이 부서 밑에 하위 부서 추가</button></div>
        </section>`; }).join('')}
      <div class="lvLine"><span>＋</span></div>
      <button id="addG" class="ghost">＋ 최상위 부서 추가</button>`);
    // 같은 상위 부서끼리 순서 바꾸기
    const swapSib = (gi, dir) => {
      const sib = g.filter((x) => (x.parent || '') === (g[gi].parent || ''));
      const k = sib.indexOf(g[gi]), t = sib[k + dir]; if (!t) return;
      const a = g.indexOf(g[gi]), b = g.indexOf(t); [g[a], g[b]] = [g[b], g[a]]; draw();
    };
    const sw = (arr, i, j) => { if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; draw(); };
    $app.querySelectorAll('.gname').forEach((el) => el.oninput = () => { g[el.dataset.g].name = el.value; });
    $app.querySelectorAll('[data-par]').forEach((el) => el.onchange = () => {
      const x = g[el.dataset.par], v = el.value;
      x.side = v.startsWith('side:'); x.parent = x.side ? v.slice(5) : v; draw();
    });
    $app.querySelectorAll('[data-m]').forEach((el) => el.oninput = el.onchange = () => {
      const [gi, mi, k] = el.dataset.m.split(':'); g[gi].members[mi][k] = el.value;
      if (k === 'color') el.className = 'pcSel pc-' + el.value;
    });
    $app.querySelectorAll('[data-gu]').forEach((b) => b.onclick = () => swapSib(+b.dataset.gu, -1));
    $app.querySelectorAll('[data-gd]').forEach((b) => b.onclick = () => swapSib(+b.dataset.gd, 1));
    $app.querySelectorAll('[data-gx]').forEach((b) => b.onclick = () => {
      const x = g[+b.dataset.gx];
      if (!confirm(`"${x.name}" 부서를 지울까요?${g.some((y) => y.parent === x.id) ? ' 밑에 있던 부서는 한 단계 위로 올라가요.' : ''}`)) return;
      g.forEach((y) => { if (y.parent === x.id) y.parent = x.parent || ''; }); g.splice(+b.dataset.gx, 1); draw();
    });
    $app.querySelectorAll('[data-mu]').forEach((b) => b.onclick = () => { const [gi, mi] = b.dataset.mu.split(':').map(Number); sw(g[gi].members, mi, mi - 1); });
    $app.querySelectorAll('[data-md]').forEach((b) => b.onclick = () => { const [gi, mi] = b.dataset.md.split(':').map(Number); sw(g[gi].members, mi, mi + 1); });
    $app.querySelectorAll('[data-mx]').forEach((b) => b.onclick = () => { const [gi, mi] = b.dataset.mx.split(':').map(Number); g[gi].members.splice(mi, 1); draw(); });
    $app.querySelectorAll('[data-ma]').forEach((b) => b.onclick = () => { (g[+b.dataset.ma].members ||= []).push({ name: '', title: '', rr: '', duty: '', backup: '' }); draw(); });
    const newId = () => 'g' + Math.random().toString(36).slice(2, 8);
    $app.querySelectorAll('[data-sub]').forEach((b) => b.onclick = () => { g.push({ id: newId(), name: '새 부서', parent: g[+b.dataset.sub].id, members: [] }); draw(); });
    document.getElementById('addG').onclick = () => { g.push({ id: newId(), name: '새 부서', parent: '', members: [] }); draw(); };
    document.getElementById('cancel').onclick = () => go('org');
    document.getElementById('saveOrg').onclick = async () => {
      g.forEach((grp) => { grp.members = (grp.members || []).filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim() })); grp.side = !!grp.side; });
      const mainG = g.find((x) => !x.parent); g.forEach((grp) => { grp.doctor = grp === mainG; });
      const missing = orgOrder({ groups: g }).map((x) => x.name).filter((n) => !people.some((p) => p.name === n && p.status !== 'rejected'));
      if (missing.length && me.role === 'admin' && confirm(`회원 명부에 없는 이름이 있어요: ${missing.join(', ')}\n명부(미가입)에 추가할까요? 추가해야 근무표에 나와요.`)) {
        for (const n of missing) {
          const grp = g.find((x) => x.members.some((m) => m.name === n)); const m = grp.members.find((x) => x.name === n);
          await addDoc(collection(db, 'users'), { name: n, job: m.title || '', dept: grp.name, team: /팀/.test(grp.name) ? grp.name : '', role: !grp.parent ? 'doctor' : 'staff',
            phone: '', email: '', hireDate: '', work: '재직', annualAdjust: 0, status: 'roster', createdAt: serverTimestamp() });
        }
      }
      await setDoc(doc(db, 'org', 'main'), { groups: g, updatedAt: serverTimestamp(), updatedBy: me.name });
      toast('조직도를 저장했어요'); go('org');
    };
  };
  draw();
}

// ---------- 보안정책 ----------
function renderSecurity() {
  const sec = (n, t, items) => `<section class="sec"><h2>${n}. ${t}</h2>${items.map((i) => `<p>· ${i}</p>`).join('')}</section>`;
  const qa = [
    ['다른 직원이 내 급여나 연봉을 볼 수 있나요?', '아니요. 연봉·급여명세서는 본인과 관리자(대표원장, 경영실장)만 볼 수 있어요. 총괄실장, 팀장, 다른 원장님도 볼 수 없어요.'],
    ['원장님이나 관리자가 내 비밀번호를 알 수 있나요?', '아니요. 비밀번호는 구글(Firebase)의 인증 시스템에 암호화되어 보관되고, 관리자를 포함해 누구도 볼 수 없어요. 잊어버리면 로그인 화면의 "비밀번호 찾기"로 다시 설정하세요.'],
    ['환자 정보도 여기에 저장되나요?', '아니요. 이 직원포털에는 환자의 이름·연락처·진료기록을 저장하지 않아요.'],
    ['공용 PC에서 써도 되나요?', '사용 후 꼭 오른쪽 위 "로그아웃"을 눌러 주세요. 로그아웃하지 않으면 그 기기에서 로그인 상태가 유지돼요.'],
    ['퇴사하면 어떻게 되나요?', '관리자가 재직상태를 "퇴사"로 바꾸는 즉시 접속이 막혀요.']
  ];
  shell(`
    <p class="eyebrow">SECURITY</p><h1>보안정책</h1>
    <section class="card secCard">
      ${sec(1, '데이터 보관', ['모든 데이터는 구글 클라우드(Firebase)의 서울 리전 데이터베이스에 저장돼요.', '주고받는 모든 내용은 암호화된 연결(HTTPS)로 전송돼요.'])}
      ${sec(2, '접근 권한', ['로그인한 뒤 관리자가 가입을 승인한 직원만 사용할 수 있어요.', '관리자·원장·총괄실장·팀장·직원 등 역할에 따라 볼 수 있는 화면과 데이터가 나뉘어요.', '이 권한은 화면에서만 숨기는 게 아니라 데이터베이스(서버)에서 직접 막혀 있어서, 다른 방법으로 접근해도 볼 수 없어요.'])}
      ${sec(3, '개인정보 보호', ['연봉·급여명세서는 본인과 관리자만, 연차 신청 내역은 본인과 관리자·총괄실장(같은 팀 팀장)만 볼 수 있어요.', '주민등록번호·생년월일은 저장하지 않아요.', '환자 개인정보는 저장하지 않아요.'])}
      ${sec(4, '계정 보호', ['비밀번호는 구글 인증 시스템에 암호화되어 보관되며, 치과에서는 볼 수 없어요.', '퇴사 처리된 계정은 즉시 접속이 차단돼요.'])}
    </section>
    <section class="card secCard">
      <h2 class="secH">자주 묻는 질문</h2>
      ${qa.map(([q, a]) => `<div class="qa"><b>Q. ${q}</b><p>A. ${a}</p></div>`).join('')}
    </section>`);
}

// ---------- 화면 설정 (관리자) ----------
function renderSettings() {
  const t = { ...theme };
  shell(`
    <h1>화면 설정</h1>
    <p class="muted sm">여기서 바꾼 내용은 모든 직원 화면에 적용돼요.</p>
    <section class="card">
      <h2>글씨체</h2>
      <div class="chips" id="font">${Object.entries(FONTS).map(([k, f]) => `<button data-v="${k}" style="font-family:${f.family.replace(/"/g, "'")}">${f.label}</button>`).join('')}</div>
      <h2 class="mt">기본 글씨 크기</h2>
      <div class="chips" id="size">${Object.entries(SIZES).map(([k, v]) => `<button data-v="${k}">${v[0]}</button>`).join('')}</div>
      <h2 class="mt">대표 색상</h2>
      <div class="swatches" id="color">${COLORS.map((c) => `<button data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
        <label class="custom">직접 고르기<input type="color" id="colorPick" value="${t.color}"></label></div>
    </section>
    <section class="card form">
      <h2>치과 이름과 로고</h2>
      <label>치과 이름<input id="clinicName" value="${esc(t.clinicName)}"></label>
      <label>로고 이미지 (정사각형 권장)<input type="file" id="logoFile" accept="image/*"></label>
      <div class="row" id="logoRow">${t.logo ? `<img src="${t.logo}" class="logoPrev"><button id="logoDel" class="ghost danger sm">로고 빼기</button>` : '<span class="muted sm">로고 없음</span>'}</div>
    </section>
    <section class="card">
      <h2>미리보기</h2>
      <div id="preview" class="preview"></div>
    </section>
    <div class="row"><button id="save" class="primary">저장하고 모두에게 적용</button><button id="reset" class="ghost">처음 상태로</button></div>`);

  const mark = () => {
    for (const [id, key] of [['font', 'font'], ['size', 'size'], ['color', 'color']])
      document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === t[key]));
    const f = FONTS[t.font];
    if (f.css && !document.querySelector(`link[data-font="${t.font}"]`)) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = f.css; l.dataset.font = t.font; document.head.appendChild(l);
    }
    document.getElementById('preview').innerHTML = `
      <div style="font-family:${f.family.replace(/"/g, "'")};font-size:${SIZES[t.size][1]}px;--c:${t.color}">
        <div class="brand small">${t.logo ? `<img src="${t.logo}" alt="">` : ''}${esc(t.clinicName)}<span>직원포털</span></div>
        <p>환자분께 친절하게, 기구는 깨끗하게. 오늘도 수고 많으셨습니다.</p>
        <button class="primary">버튼 예시</button>
      </div>`;
  };
  ['font', 'size', 'color'].forEach((id) => document.querySelectorAll(`#${id} button`).forEach((b) => b.onclick = () => { t[id] = b.dataset.v; mark(); }));
  document.getElementById('colorPick').oninput = (e) => { t.color = e.target.value; mark(); };
  document.getElementById('clinicName').oninput = (e) => { t.clinicName = e.target.value.trim() || '치과'; mark(); };
  document.getElementById('logoFile').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    t.logo = await shrinkImage(file, 160);
    document.getElementById('logoRow').innerHTML = `<img src="${t.logo}" class="logoPrev">`;
    mark();
  };
  document.getElementById('logoDel')?.addEventListener('click', () => { t.logo = ''; document.getElementById('logoRow').innerHTML = '<span class="muted sm">로고 없음</span>'; mark(); });
  document.getElementById('save').onclick = async () => {
    await setDoc(doc(db, 'settings', 'app'), { font: t.font, size: t.size, color: t.color, clinicName: t.clinicName, logo: t.logo });
    theme = t; localStorage.setItem('theme', JSON.stringify(theme)); applyTheme();
    toast('모두에게 적용했어요'); render();
  };
  document.getElementById('reset').onclick = () => { Object.assign(t, DEFAULT_THEME); renderSettingsKeep(t); };
  mark();
}
function renderSettingsKeep(t) { const old = theme; theme = t; renderSettings(); theme = old; }

// 로고를 작게 줄여서 저장 (파일 저장소 없이 설정에 바로 저장)
function shrinkImage(file, max) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.src = URL.createObjectURL(file);
  });
}

// ---------- 시작 ----------
async function loadMe(user, rerender = true) {
  const d = await getDoc(doc(db, 'users', user.uid));
  if (!d.exists()) { await signOut(auth); return renderAuth('login', '직원 정보가 없어요. 관리자에게 문의해 주세요.'); }
  me = { uid: user.uid, ...d.data() };
  applyTheme();
  if (!rerender) return;
  if (me.status !== 'active' || me.work === '퇴사') return renderWaiting();
  await countDocPending();
  render();
}

applyTheme();
loadTheme().then(() => document.querySelectorAll('.brand').forEach((b) => { if (!b.closest('.preview')) b.outerHTML = brand(b.classList.contains('small') ? 'small' : ''); }));

onAuthStateChanged(auth, async (user) => {
  if (signingUp) return;
  if (!user) { me = null; applyTheme(); return renderAuth('login'); }
  try { await loadMe(user); }
  catch (e) { console.error(e); renderAuth('login', '정보를 불러오지 못했어요: ' + (e.code || e.message)); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
