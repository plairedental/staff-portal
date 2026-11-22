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
let view = 'my';        // my | hr | manual
let sub = null;         // 하위 화면 상태
let signingUp = false;  // 가입 처리 중에는 자동 로그인 처리 건너뜀

// ---------- 유틸 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (n || n === 0) && n !== '' ? Number(n).toLocaleString('ko-KR') + '원' : '-';
const can = {
  hr: () => ['admin', 'doctor', 'chief', 'leader'].includes(me.role),
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
  const rejected = me.status === 'rejected';
  $app.innerHTML = `
    <div class="auth">
      ${brand()}
      <div class="card center">
        <p class="big">${rejected ? '가입이 승인되지 않았어요.' : '가입 신청이 완료됐어요.'}</p>
        <p>${rejected ? '관리자에게 문의해 주세요.' : '관리자가 승인하면 바로 사용할 수 있어요.<br>승인 후 이 화면을 새로고침해 주세요.'}</p>
        <button id="reload" class="primary">새로고침</button>
        <button id="out" class="ghost">로그아웃</button>
      </div>
    </div>`;
  document.getElementById('reload').onclick = () => location.reload();
  document.getElementById('out').onclick = () => signOut(auth);
}

// ---------- 화면 틀 ----------
function shell(content) {
  const tabs = [['my', '내 정보', '👤'], ...(can.hr() ? [['hr', '인사관리', '👥']] : []), ['work', '연차·근무', '📅'], ['manual', '매뉴얼', '📘'], ...(me.role === 'admin' ? [['settings', '화면 설정', '🎨']] : [])];
  $app.innerHTML = `
    <header>
      ${brand('small')}
      <nav>${tabs.map(([k, t, i]) => `<button data-v="${k}" class="${view === k ? 'on' : ''}"><i>${i}</i>${t}</button>`).join('')}</nav>
      <div class="who">${esc(me.name)} · ${ROLES[me.role]} <button id="out" class="ghost sm">로그아웃</button></div>
    </header>
    <main>${content}</main>`;
  $app.querySelectorAll('nav button').forEach((b) => b.onclick = () => go(b.dataset.v));
  document.getElementById('out').onclick = () => signOut(auth);
}
function go(v, s = null) { view = v; sub = s; render(); }

async function render() {
  shell('<p class="muted">불러오는 중…</p>');
  try {
    if (view === 'hr' && can.hr()) return await renderHr();
    if (view === 'manual') return await renderManual();
    if (view === 'work') return await renderWork();
    if (view === 'settings' && me.role === 'admin') return renderSettings();
    view = 'my'; return await renderMy();
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
    <h1>내 정보</h1>
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
      <h2>급여</h2>
      ${sal ? `<dl class="info"><dt>월 급여</dt><dd>${won(sal.monthly)}</dd>${sal.note ? `<dt>메모</dt><dd>${esc(sal.note)}</dd>` : ''}</dl>`
            : '<p class="muted">아직 등록된 급여 정보가 없어요.</p>'}
      <p class="muted sm">급여는 본인과 관리자만 볼 수 있어요.</p>
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
  const active = people.filter((p) => p.status === 'active');
  const showWork = sub?.showAll ? active : active.filter((p) => (p.work || '재직') !== '퇴사');

  shell(`
    <h1>인사관리</h1>
    ${can.editHr() && pending.length ? `
      <section class="card warn">
        <h2>가입 승인 대기 (${pending.length})</h2>
        ${pending.map((p) => `
          <div class="pending">
            <div><b>${esc(p.name)}</b> <span class="muted sm">${esc(p.email)} ${esc(p.phone)}</span></div>
            <div class="row">
              <select id="r_${p.uid}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === 'staff' ? 'selected' : ''}>${v}</option>`).join('')}</select>
              <input id="t_${p.uid}" placeholder="팀 (예: 진료1팀)">
              <button data-ok="${p.uid}" class="primary">승인</button>
              <button data-no="${p.uid}" class="ghost">거절</button>
            </div>
          </div>`).join('')}
      </section>` : ''}
    <section class="card">
      <div class="row between"><h2>직원 ${showWork.length}명</h2>
        <label class="sm"><input type="checkbox" id="showAll" ${sub?.showAll ? 'checked' : ''}> 퇴사자 포함</label></div>
      <div class="list">
        ${showWork.map((p) => `
          <button class="item" data-p="${p.uid}">
            <b>${esc(p.name)}</b>
            <span>${esc(p.job) || ''}${p.team ? ' · ' + esc(p.team) : ''}</span>
            <span class="tag">${ROLES[p.role]}</span>
            ${(p.work && p.work !== '재직') ? `<span class="tag gray">${esc(p.work)}</span>` : ''}
          </button>`).join('') || '<p class="muted">아직 직원이 없어요.</p>'}
      </div>
    </section>`);

  $app.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => go('hr', { uid: b.dataset.p }));
  document.getElementById('showAll').onchange = (e) => go('hr', { showAll: e.target.checked });
  $app.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
    const uid = b.dataset.ok;
    await updateDoc(doc(db, 'users', uid), {
      status: 'active', role: document.getElementById('r_' + uid).value,
      team: val('t_' + uid), work: '재직'
    });
    toast('승인했어요'); render();
  });
  $app.querySelectorAll('[data-no]').forEach((b) => b.onclick = async () => {
    if (!confirm('가입을 거절할까요?')) return;
    await updateDoc(doc(db, 'users', b.dataset.no), { status: 'rejected' });
    toast('거절했어요'); render();
  });
}

async function renderPerson(uid) {
  const d = await getDoc(doc(db, 'users', uid));
  if (!d.exists()) return go('hr');
  const p = { uid, ...d.data() };
  const back = '<button id="back" class="ghost">← 목록</button>';

  if (!can.editHr()) {
    shell(`${back}<h1>${esc(p.name)}</h1><section class="card">${infoRows(p)}</section>`);
    document.getElementById('back').onclick = () => go('hr');
    return;
  }

  const s = await getDoc(doc(db, 'salaries', uid));
  const sal = s.exists() ? s.data() : {};
  const f = (id, label, v, type = 'text') => `<label>${label}<input id="${id}" type="${type}" value="${esc(v)}"></label>`;
  shell(`
    ${back}<h1>${esc(p.name)}</h1>
    <section class="card form">
      ${f('name', '이름', p.name)}
      ${f('job', '직무 (예: 치과위생사)', p.job)}
      ${f('dept', '부서 (예: 진료실, 데스크)', p.dept)}
      ${f('team', '팀', p.team)}
      <label>역할<select id="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${f('phone', '연락처', p.phone)}
      <label>이메일<input value="${esc(p.email)}" disabled></label>
      ${f('hireDate', '입사일', p.hireDate, 'date')}
      <label>재직상태<select id="work">${WORK.map((w) => `<option ${(p.work || '재직') === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
      ${f('annualAdjust', '연차 조정 (일, 예: 2 또는 -1)', p.annualAdjust ?? '', 'number')}
    </section>
    <section class="card form">
      <h2>급여 <span class="muted sm">(본인과 관리자만 볼 수 있어요)</span></h2>
      ${f('monthly', '월 급여 (원)', sal.monthly ?? '', 'number')}
      ${f('note', '메모 (예: 세전, 식대 포함)', sal.note ?? '')}
    </section>
    <div class="row"><button id="save" class="primary">저장</button>
      ${uid !== me.uid ? '<button id="del" class="ghost danger">계정 정보 삭제</button>' : ''}</div>`);

  document.getElementById('back').onclick = () => go('hr');
  document.getElementById('save').onclick = async () => {
    await updateDoc(doc(db, 'users', uid), {
      name: val('name'), job: val('job'), dept: val('dept'), team: val('team'),
      role: document.getElementById('role').value, phone: val('phone'),
      hireDate: val('hireDate'), work: document.getElementById('work').value,
      annualAdjust: val('annualAdjust') === '' ? 0 : Number(val('annualAdjust'))
    });
    const m = val('monthly');
    await setDoc(doc(db, 'salaries', uid), { monthly: m === '' ? null : Number(m), note: val('note'), updatedAt: serverTimestamp() });
    if (uid === me.uid) await loadMe(auth.currentUser, false);
    toast('저장했어요'); go('hr');
  };
  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm(`${p.name} 님의 정보를 삭제할까요? 퇴사자는 삭제 대신 재직상태를 '퇴사'로 바꾸는 걸 권해요.`)) return;
    await deleteDoc(doc(db, 'salaries', uid)).catch(() => {});
    await deleteDoc(doc(db, 'users', uid));
    toast('삭제했어요'); go('hr');
  });
}

// ---------- 매뉴얼 ----------
async function renderManual() {
  if (sub?.edit !== undefined) return renderManualEdit(sub.edit);
  if (sub?.id) return renderManualView(sub.id);
  const snap = await getDocs(query(collection(db, 'manuals'), orderBy('title')));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  shell(`
    <div class="row between"><h1>매뉴얼</h1>${can.editManual() ? '<button id="new" class="primary">+ 새 매뉴얼</button>' : ''}</div>
    <input id="q" class="search" placeholder="검색 (제목, 내용)" value="${esc(sub?.q || '')}">
    <div class="list" id="ml"></div>`);
  const draw = () => {
    const q = val('q').toLowerCase();
    const list = all.filter((m) => !q || (m.title + ' ' + m.body).toLowerCase().includes(q));
    document.getElementById('ml').innerHTML = list.map((m) => `
      <button class="item" data-m="${m.id}"><b>${esc(m.title)}</b><span class="muted sm">${esc((m.body || '').slice(0, 60))}</span></button>`).join('')
      || `<p class="muted">${all.length ? '검색 결과가 없어요.' : '아직 매뉴얼이 없어요.'}</p>`;
    $app.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => go('manual', { id: b.dataset.m }));
  };
  document.getElementById('q').oninput = draw; draw();
  document.getElementById('new')?.addEventListener('click', () => go('manual', { edit: null }));
}

async function renderManualView(id) {
  const d = await getDoc(doc(db, 'manuals', id));
  if (!d.exists()) return go('manual');
  const m = d.data();
  const when = m.updatedAt?.toDate ? m.updatedAt.toDate().toLocaleDateString('ko-KR') : '';
  shell(`
    <button id="back" class="ghost">← 목록</button>
    <h1>${esc(m.title)}</h1>
    <p class="muted sm">${when ? '수정일 ' + when : ''}${m.updatedBy ? ' · ' + esc(m.updatedBy) : ''}</p>
    <article class="card manual">${esc(m.body)}</article>
    ${can.editManual() ? '<div class="row"><button id="edit">수정</button><button id="del" class="ghost danger">삭제</button></div>' : ''}`);
  document.getElementById('back').onclick = () => go('manual');
  document.getElementById('edit')?.addEventListener('click', () => go('manual', { edit: id }));
  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm('이 매뉴얼을 삭제할까요? 되돌릴 수 없어요.')) return;
    await deleteDoc(doc(db, 'manuals', id)); toast('삭제했어요'); go('manual');
  });
}

async function renderManualEdit(id) {
  let m = { title: '', body: '' };
  if (id) { const d = await getDoc(doc(db, 'manuals', id)); if (d.exists()) m = d.data(); }
  shell(`
    <button id="back" class="ghost">← 취소</button>
    <h1>${id ? '매뉴얼 수정' : '새 매뉴얼'}</h1>
    <section class="card form">
      <label>제목<input id="title" value="${esc(m.title)}"></label>
      <label>내용<textarea id="body" rows="16">${esc(m.body)}</textarea></label>
    </section>
    <button id="save" class="primary">저장</button>`);
  document.getElementById('back').onclick = () => go('manual', id ? { id } : null);
  document.getElementById('save').onclick = async () => {
    const data = { title: val('title') || '제목 없음', body: document.getElementById('body').value, updatedAt: serverTimestamp(), updatedBy: me.name };
    if (id) await setDoc(doc(db, 'manuals', id), data);
    else { const r = await addDoc(collection(db, 'manuals'), data); id = r.id; }
    toast('저장했어요'); go('manual', { id });
  };
}

// ---------- 연차·근무표 ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const LEAVE_TYPES = { '연차': 1, '오전반차': 0.5, '오후반차': 0.5 };
const STAMPS = [['', '근무'], ['휴무', '휴무'], ['오전', '오전'], ['오후', '오후'], ['야간', '야간'], ['연차', '연차'], ['반차', '반차']];
const canApprove = () => ['admin', 'chief'].includes(me?.role);

// 근로기준법 기준 연차 (입사일 기준, 출근율 80% 이상 가정)
function leavePeriod(hireDate, today = new Date()) {
  if (!hireDate) return null;
  const h = parseD(hireDate);
  let years = today.getFullYear() - h.getFullYear();
  const anniv = new Date(today.getFullYear(), h.getMonth(), h.getDate());
  if (today < anniv) years--;
  if (years < 1) {
    let months = (today.getFullYear() - h.getFullYear()) * 12 + today.getMonth() - h.getMonth();
    if (today.getDate() < h.getDate()) months--;
    const end = new Date(h); end.setFullYear(end.getFullYear() + 1);
    return { start: hireDate, end: ymd(end), days: Math.max(0, Math.min(11, months)), label: '입사 1년 미만 (1개월 개근마다 1일)' };
  }
  const start = new Date(h); start.setFullYear(h.getFullYear() + years);
  const end = new Date(start); end.setFullYear(end.getFullYear() + 1);
  return { start: ymd(start), end: ymd(end), days: Math.min(25, 15 + Math.floor((years - 1) / 2)), label: `근속 ${years}년차` };
}
function balanceOf(user, leaves) {
  const p = leavePeriod(user.hireDate);
  const adj = Number(user.annualAdjust || 0);
  if (!p) return { total: adj, used: 0, left: adj, period: null };
  const used = leaves.filter((l) => l.uid === user.uid && l.status === '승인' && l.start >= p.start && l.start < p.end)
    .reduce((s, l) => s + Number(l.days || 0), 0);
  return { total: p.days + adj, used, left: p.days + adj - used, period: p };
}
function countDays(start, end, type) {
  if (LEAVE_TYPES[type] === 0.5) return 0.5;
  let n = 0;
  for (let d = parseD(start); d <= parseD(end); d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) n++;
  return n;
}
async function loadLeaves() {
  const col = collection(db, 'leaves');
  let q;
  if (canApprove()) q = col;
  else if (me.role === 'leader') q = query(col, where('team', '==', me.team || ''));
  else q = query(col, where('uid', '==', me.uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.start.localeCompare(a.start));
}
// 승인된 연차를 근무표에 반영 (code가 null이면 지움)
async function stampLeave(l, code) {
  const byMonth = {};
  const days = LEAVE_TYPES[l.type] === 0.5 ? [l.start] : [];
  if (!days.length) for (let d = parseD(l.start); d <= parseD(l.end); d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) days.push(ymd(d));
  days.forEach((s) => { (byMonth[s.slice(0, 7)] ||= []).push(Number(s.slice(8))); });
  for (const [month, ds] of Object.entries(byMonth)) {
    const ref = doc(db, 'schedules', month);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : { people: [], cells: {} };
    data.cells ||= {}; data.cells[l.uid] ||= {};
    ds.forEach((d) => { if (code) data.cells[l.uid][d] = code; else delete data.cells[l.uid][d]; });
    if (!data.people.some((p) => p.uid === l.uid)) data.people.push({ uid: l.uid, name: l.name, team: l.team || '' });
    await setDoc(ref, data);
  }
}

async function renderWork() {
  const tab = sub?.tab || 'schedule';
  const head = `<h1>연차·근무</h1>
    <div class="chips seg"><button data-t="schedule" class="${tab === 'schedule' ? 'on' : ''}">근무표</button><button data-t="leave" class="${tab === 'leave' ? 'on' : ''}">연차</button></div>`;
  const bindTabs = () => $app.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => go('work', { tab: b.dataset.t }));
  if (tab === 'leave') return renderLeave(head, bindTabs);
  return renderSchedule(head, bindTabs);
}

async function renderLeave(head, bindTabs) {
  const leaves = await loadLeaves();
  const mine = leaves.filter((l) => l.uid === me.uid);
  const bal = balanceOf(me, mine);
  const pending = leaves.filter((l) => l.status === '대기' && l.uid !== me.uid);
  const today = ymd(new Date());
  let people = [];
  if (canApprove()) people = (await loadPeople()).filter((p) => p.status === 'active' && (p.work || '재직') !== '퇴사');

  const row = (l, actions = '') => `
    <div class="lv">
      <div><b>${esc(l.name)}</b> <span class="muted sm">${esc(l.type)} · ${l.start}${l.end && l.end !== l.start ? ' ~ ' + l.end : ''} (${l.days}일)</span>
        ${l.reason ? `<div class="sm muted">${esc(l.reason)}</div>` : ''}</div>
      <div class="row"><span class="tag ${l.status === '승인' ? '' : 'gray'}">${l.status}</span>${actions}</div>
    </div>`;

  shell(`${head}
    <section class="card">
      <h2>내 연차</h2>
      ${bal.period ? `<div class="stats"><div><b>${bal.total}</b><span>발생</span></div><div><b>${bal.used}</b><span>사용</span></div><div><b>${bal.left}</b><span>남음</span></div></div>
        <p class="muted sm">${bal.period.label} · 기간 ${bal.period.start} ~ ${bal.period.end}</p>`
        : '<p class="muted">입사일이 등록되지 않아 연차를 계산할 수 없어요. 관리자에게 입사일 등록을 요청해 주세요.</p>'}
    </section>
    <section class="card form">
      <h2>연차 신청</h2>
      <label>종류<select id="lt">${Object.keys(LEAVE_TYPES).map((t) => `<option>${t}</option>`).join('')}</select></label>
      <div class="two"><label>시작일<input type="date" id="ls" value="${today}"></label><label id="leWrap">종료일<input type="date" id="le" value="${today}"></label></div>
      <label>사유 (선택)<input id="lr" placeholder="예: 개인 사정"></label>
      <p class="sm" id="lcount"></p>
      <button id="lsend" class="primary">신청하기</button>
    </section>
    ${canApprove() && pending.length ? `<section class="card warn"><h2>승인 대기 (${pending.length})</h2>
      ${pending.map((l) => row(l, `<button data-ok="${l.id}" class="primary sm">승인</button><button data-no="${l.id}" class="ghost sm">반려</button>`)).join('')}</section>` : ''}
    ${me.role === 'leader' && pending.length ? `<section class="card"><h2>우리 팀 신청 (${pending.length})</h2>${pending.map((l) => row(l)).join('')}
      <p class="muted sm">승인은 관리자·총괄실장이 해요.</p></section>` : ''}
    ${canApprove() ? `<section class="card"><h2>직원별 연차</h2>
      <div class="tbl"><table><tr><th>이름</th><th>발생</th><th>사용</th><th>남음</th></tr>
      ${people.map((p) => { const b = balanceOf(p, leaves); return `<tr><td>${esc(p.name)}</td><td>${b.period ? b.total : '입사일 없음'}</td><td>${b.used}</td><td><b>${b.left}</b></td></tr>`; }).join('')}
      </table></div><p class="muted sm">입사일 기준, 출근율 80% 이상을 가정한 계산이에요. 조정은 인사관리 → 직원 → "연차 조정"에서 해요.</p></section>` : ''}
    <section class="card"><h2>${canApprove() ? '전체 신청 내역' : me.role === 'leader' ? '우리 팀 신청 내역' : '내 신청 내역'}</h2>
      ${leaves.filter((l) => l.status !== '대기' || l.uid === me.uid || !canApprove()).slice(0, 50).map((l) => row(l,
        (l.uid === me.uid && l.status === '대기') ? `<button data-cancel="${l.id}" class="ghost sm">취소</button>`
        : (canApprove() && l.status === '승인') ? `<button data-undo="${l.id}" class="ghost sm danger">승인 취소</button>` : '')).join('') || '<p class="muted">내역이 없어요.</p>'}
    </section>`);
  bindTabs();

  const upd = () => {
    const t = document.getElementById('lt').value;
    const half = LEAVE_TYPES[t] === 0.5;
    document.getElementById('leWrap').style.display = half ? 'none' : '';
    const s = val('ls'), e = half ? s : val('le');
    document.getElementById('lcount').textContent = s && e && e >= s ? `사용 일수: ${countDays(s, e, t)}일 (일요일 제외)` : '종료일을 확인해 주세요.';
  };
  ['lt', 'ls', 'le'].forEach((id) => document.getElementById(id).oninput = upd); upd();
  document.getElementById('lsend').onclick = async () => {
    const type = val('lt'), start = val('ls'), end = LEAVE_TYPES[type] === 0.5 ? start : val('le');
    if (!start || end < start) return toast('날짜를 확인해 주세요');
    await addDoc(collection(db, 'leaves'), {
      uid: me.uid, name: me.name, team: me.team || '', type, start, end, days: countDays(start, end, type),
      reason: val('lr'), status: '대기', createdAt: serverTimestamp()
    });
    toast('신청했어요'); go('work', { tab: 'leave' });
  };
  const find = (id) => leaves.find((l) => l.id === id);
  $app.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
    const l = find(b.dataset.ok);
    await updateDoc(doc(db, 'leaves', l.id), { status: '승인', decidedBy: me.name });
    await stampLeave(l, LEAVE_TYPES[l.type] === 0.5 ? '반차' : '연차');
    toast('승인하고 근무표에 반영했어요'); go('work', { tab: 'leave' });
  });
  $app.querySelectorAll('[data-no]').forEach((b) => b.onclick = async () => {
    await updateDoc(doc(db, 'leaves', b.dataset.no), { status: '반려', decidedBy: me.name });
    toast('반려했어요'); go('work', { tab: 'leave' });
  });
  $app.querySelectorAll('[data-undo]').forEach((b) => b.onclick = async () => {
    if (!confirm('승인을 취소할까요? 근무표에서도 지워져요.')) return;
    const l = find(b.dataset.undo);
    await updateDoc(doc(db, 'leaves', l.id), { status: '반려', decidedBy: me.name });
    await stampLeave(l, null);
    toast('승인을 취소했어요'); go('work', { tab: 'leave' });
  });
  $app.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => {
    if (!confirm('신청을 취소할까요?')) return;
    await deleteDoc(doc(db, 'leaves', b.dataset.cancel)); toast('취소했어요'); go('work', { tab: 'leave' });
  });
}

async function renderSchedule(head, bindTabs) {
  const now = new Date();
  const month = sub?.month || `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const ref = doc(db, 'schedules', month);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : { people: [], cells: {} };
  data.cells ||= {}; data.people ||= [];
  const editor = canApprove();
  if (editor) {   // 현재 재직자로 명단 맞추기
    const act = (await loadPeople()).filter((p) => p.status === 'active' && (p.work || '재직') !== '퇴사');
    act.forEach((p) => { const o = data.people.find((x) => x.uid === p.uid); if (o) { o.name = p.name; o.team = p.team || ''; } else data.people.push({ uid: p.uid, name: p.name, team: p.team || '' }); });
    data.people = data.people.filter((x) => act.some((p) => p.uid === x.uid) || Object.keys(data.cells[x.uid] || {}).length);
  }
  data.people.sort((a, b) => (a.team || '').localeCompare(b.team || '', 'ko') || a.name.localeCompare(b.name, 'ko'));
  const shift = (k) => { const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const DOW = '일월화수목금토';
  let stamp = sub?.stamp ?? '휴무';
  let dirty = false;

  const cellHtml = (uid, d) => { const c = data.cells[uid]?.[d] || ''; return `<td data-u="${uid}" data-d="${d}" class="c ${c ? 'k-' + c : ''} ${new Date(y, m - 1, d).getDay() === 0 ? 'sun' : ''}">${c}</td>`; };
  shell(`${head}
    <div class="row between month"><button id="prev" class="ghost">◀</button><b>${y}년 ${m}월</b><button id="next" class="ghost">▶</button></div>
    ${editor ? `<div class="chips stamps">${STAMPS.map(([k, t]) => `<button data-s="${k}" class="${stamp === k ? 'on' : ''} ${k ? 'k-' + k : ''}">${t}</button>`).join('')}</div>
      <p class="muted sm">도장을 고르고 칸을 누르세요. 빈칸은 정상 근무예요.</p>` : ''}
    <div class="sched"><table>
      <tr><th class="nm">이름</th>${Array.from({ length: last }, (_, i) => { const dw = new Date(y, m - 1, i + 1).getDay(); return `<th class="${dw === 0 ? 'sun' : dw === 6 ? 'sat' : ''}">${i + 1}<br><small>${DOW[dw]}</small></th>`; }).join('')}</tr>
      ${data.people.map((p) => `<tr class="${p.uid === me.uid ? 'mine' : ''}"><th class="nm">${esc(p.name)}${p.team ? `<small>${esc(p.team)}</small>` : ''}</th>${Array.from({ length: last }, (_, i) => cellHtml(p.uid, i + 1)).join('')}</tr>`).join('')
        || `<tr><td class="muted" colspan="${last + 1}">아직 근무표가 없어요.</td></tr>`}
    </table></div>
    ${editor ? '<div class="row"><button id="saveSched" class="primary">근무표 저장</button><span class="muted sm" id="dirty"></span></div>' : ''}`);
  bindTabs();
  const leave = (fn) => () => { if (dirty && !confirm('저장하지 않은 변경이 있어요. 이동할까요?')) return; fn(); };
  document.getElementById('prev').onclick = leave(() => go('work', { tab: 'schedule', month: shift(-1), stamp }));
  document.getElementById('next').onclick = leave(() => go('work', { tab: 'schedule', month: shift(1), stamp }));
  $app.querySelectorAll('[data-t]').forEach((b) => b.onclick = leave(() => go('work', { tab: b.dataset.t })));
  if (!editor) return;
  $app.querySelectorAll('.stamps button').forEach((b) => b.onclick = () => {
    stamp = b.dataset.s; $app.querySelectorAll('.stamps button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $app.querySelectorAll('td.c').forEach((td) => td.onclick = () => {
    const { u, d } = td.dataset;
    data.cells[u] ||= {};
    const cur = data.cells[u][d] || '';
    const next = cur === stamp ? '' : stamp;   // 같은 도장을 한 번 더 누르면 지워짐
    if (next) data.cells[u][d] = next; else delete data.cells[u][d];
    td.outerHTML = cellHtml(u, Number(d));
    dirty = true; document.getElementById('dirty').textContent = '저장 안 된 변경 있음';
    const nt = $app.querySelector(`td[data-u="${u}"][data-d="${d}"]`); nt.onclick = td.onclick;
  });
  document.getElementById('saveSched').onclick = async () => {
    await setDoc(ref, { people: data.people, cells: data.cells, updatedAt: serverTimestamp(), updatedBy: me.name });
    dirty = false; toast('근무표를 저장했어요'); document.getElementById('dirty').textContent = '';
  };
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
  if (me.status !== 'active') return renderWaiting();
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
