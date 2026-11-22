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
      <div class="brand">플레르치과<span>직원포털</span></div>
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
      <div class="brand">플레르치과<span>직원포털</span></div>
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
  const tabs = [['my', '내 정보', '👤'], ...(can.hr() ? [['hr', '인사관리', '👥']] : []), ['manual', '매뉴얼', '📘']];
  $app.innerHTML = `
    <header>
      <div class="brand small">플레르치과<span>직원포털</span></div>
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
      <h2>급여</h2>
      ${sal ? `<dl class="info"><dt>월 급여</dt><dd>${won(sal.monthly)}</dd>${sal.note ? `<dt>메모</dt><dd>${esc(sal.note)}</dd>` : ''}</dl>`
            : '<p class="muted">아직 등록된 급여 정보가 없어요.</p>'}
      <p class="muted sm">급여는 본인과 관리자만 볼 수 있어요.</p>
    </section>`);
  document.getElementById('savePhone').onclick = async () => {
    await updateDoc(doc(db, 'users', me.uid), { phone: val('phone') });
    me.phone = val('phone'); toast('저장했어요');
  };
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
      hireDate: val('hireDate'), work: document.getElementById('work').value
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

// ---------- 시작 ----------
async function loadMe(user, rerender = true) {
  const d = await getDoc(doc(db, 'users', user.uid));
  if (!d.exists()) { await signOut(auth); return renderAuth('login', '직원 정보가 없어요. 관리자에게 문의해 주세요.'); }
  me = { uid: user.uid, ...d.data() };
  if (!rerender) return;
  if (me.status !== 'active') return renderWaiting();
  render();
}

onAuthStateChanged(auth, async (user) => {
  if (signingUp) return;
  if (!user) { me = null; return renderAuth('login'); }
  try { await loadMe(user); }
  catch (e) { console.error(e); renderAuth('login', '정보를 불러오지 못했어요: ' + (e.code || e.message)); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
