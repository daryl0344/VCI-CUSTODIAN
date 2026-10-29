/* =========================================================
   VCI CUSTODIAN - script.js
   Sports Equipment Borrowing and Return System
   Veritas College of Irosin | Frontend-only (localStorage)

   HOW THIS FILE IS ORGANIZED
   1. Constants and small helpers
   2. Storage layer     - the ONLY code that touches localStorage
   3. Service layer     - all business rules (accounts, equipment, requests,
                          issuing, returns, transactions).
                          Every admin-only function checks the logged-in
                          account itself (requireAdmin) instead of trusting
                          the screen that called it. Semester 2: replace
                          the bodies of these functions with fetch() calls to
                          the backend API. The UI below does not need to change
                          except to add async/await.
   4. UI helpers        - toast, modal, badges, page shell
   5. Page controllers  - one function per page
   ========================================================= */
'use strict';

/* ---------------------------------------------------------
   1. CONSTANTS AND HELPERS
   --------------------------------------------------------- */
const KEYS = {
  accounts: 'vci_accounts',
  equipment: 'vci_equipment',
  requests: 'vci_requests',
  issuances: 'vci_issuances',
  returns: 'vci_returns',
  transactions: 'vci_transactions',
  counters: 'vci_counters',
  guard: 'vci_login_guard'           // failed-login counters (temporary lock-out)
};
const SESSION_KEY = 'vci_session';           // kept in sessionStorage (cleared when the tab closes)
// Pictures are real files in the images/ folder.
// Equipment pictures are optional. No picture = nothing is drawn (no placeholder, no empty box).
function imgSrc(p) { return p || ''; }
// If a picture cannot be loaded, hide it together with its box.
function hideBrokenImage(img) { const box = img.closest('[data-imgbox]') || img; box.hidden = true; }
// The list of pictures lives in index.html (the #equipment-pictures block). Change a file name THERE, not here.
function presetImages() {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll('#equipment-pictures img')).map((i) => ({ path: i.getAttribute('src') || '', label: i.getAttribute('alt') || '' }));
}
function pictureFor(name) {
  const hit = presetImages().find((p) => p.label.toLowerCase() === String(name).toLowerCase());
  return hit ? hit.path : '';
}

// Suggested categories. The admin can also type a custom one.
const SPORT_CATEGORIES = ['Basketball', 'Volleyball', 'Badminton', 'Football', 'Track and Field', 'Athletics', 'Table Tennis', 'Sepak Takraw', 'Other Sports'];
const EQUIP_STATUSES = ['Available', 'Unavailable', 'Damaged', 'Under Repair'];
const EQUIP_CONDITIONS = ['Good', 'Fair', 'Damaged', 'Needs Repair'];
const RETURN_CONDITIONS = ['Good', 'Damaged', 'Needs Repair'];
const REQUEST_STATUSES = ['Pending', 'Approved', 'Rejected', 'Borrowed', 'Returned', 'Overdue'];
const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
const MIN_PASSWORD = 6;
const MIN_ADMIN_PASSWORD = 8;
const SESSION_IDLE_MS = 30 * 60 * 1000;   // a session ends after 30 minutes without activity
const MAX_LOGIN_FAILS = 5;                // wrong attempts before a temporary lock-out
const LOCKOUT_MS = 5 * 60 * 1000;
const LOW_STOCK_LIMIT = 2;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ok = (data) => ({ ok: true, data });
const fail = (error, errors) => ({ ok: false, error, errors: errors || {} });
const pad = (n, len) => String(n).padStart(len, '0');

function localDateOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
function todayStr() { return localDateOf(new Date()); }
function nowIso() { return new Date().toISOString(); }
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDateOf(new Date(y, m - 1, d + n));
}
function daysBetween(a, b) { // whole days from date a to date b
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : '—';
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return fmtDate(localDateOf(d)) + ' ' + h + ':' + pad(d.getMinutes(), 2) + ' ' + ap;
}
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isInt(v) { return /^\d+$/.test(String(v).trim()); }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, ''); }

/* ---------------------------------------------------------
   2. STORAGE LAYER (localStorage)
   --------------------------------------------------------- */
function loadList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
  } catch (e) {
    console.warn('Stored data for "' + key + '" is unreadable and was ignored.', e);
    return [];
  }
}
function saveList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); return true; }
  catch (e) { console.error('Could not save "' + key + '" (storage full or blocked).', e); return false; }
}
function loadObject(key) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  catch (e) { return {}; }
}
const ID_FORMAT = { req: ['REQ-', 4], txn: ['TXN-', 4], ret: ['RET-', 4], iss: ['ISS-', 4], eq: ['EQ-', 3] };
function nextId(kind, existingList) {
  const counters = loadObject(KEYS.counters);
  const f = ID_FORMAT[kind];
  let n = (Number(counters[kind]) || 0) + 1;
  const taken = new Set((existingList || []).map((x) => x.id));
  while (taken.has(f[0] + pad(n, f[1]))) n++;
  counters[kind] = n;
  saveList(KEYS.counters, counters);
  return f[0] + pad(n, f[1]);
}
// NOTE: demo-only "hash". It only keeps plain passwords from sitting in storage in
// readable form. It is NOT secure. Real systems hash passwords on the server (bcrypt/argon2).
function hashPassword(pw) {
  let h1 = 0x811c9dc5, h2 = 5381;
  const s = 'vci-demo|' + pw;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (((h2 << 5) + h2) + c) >>> 0;
  }
  return 'demo$' + h1.toString(16) + h2.toString(16);
}

/* ---------------------------------------------------------
   3. SERVICE LAYER
   Every function returns plain data or { ok, data | error }.
   --------------------------------------------------------- */

/* ----- Setup ----- */
const SAMPLE_EQUIPMENT = [
  ['Basketball', 'Basketball', 'Standard size 7 rubber basketball for indoor and outdoor courts.', 12, 'Good'],
  ['Volleyball', 'Volleyball', 'Soft-touch volleyball for training and intramurals.', 10, 'Good'],
  ['Volleyball Net', 'Volleyball', 'Volleyball net with posts for the court.', 2, 'Good'],
  ['Soccer Ball', 'Football', 'Size 5 soccer ball for field practice and games.', 8, 'Good'],
  ['Soccer Net', 'Football', 'Soccer goal net.', 2, 'Good'],
  ['Badminton Racket', 'Badminton', 'Lightweight aluminum racket, strung.', 16, 'Good'],
  ['Shuttlecock', 'Badminton', 'Feather shuttlecock, counted per piece.', 24, 'Good'],
  ['Table Tennis Paddle', 'Table Tennis', 'Rubber-faced paddle for table tennis.', 12, 'Fair'],
  ['Table Tennis Ball', 'Table Tennis', '40mm table tennis ball, counted per piece.', 40, 'Good'],
  ['Table Tennis Net', 'Table Tennis', 'Clamp-on table tennis net set.', 2, 'Good'],
  ['Takraw', 'Sepak Takraw', 'Woven rattan takraw ball.', 6, 'Good'],
  ['Whistle', 'Athletics', 'Metal whistle with lanyard for referees and coaches.', 6, 'Good'],
  ['Training Cones', 'Track and Field', 'Orange marker cones for drills.', 30, 'Good']
];
// Demonstration Admin (frontend-only school project): created ONLY when no Admin account exists yet.
// An existing Admin account or a changed password is never overwritten.  Login: admin / admin123
function ensureDemoAdmin() {
  if (hasAdminAccount()) return;
  saveAccount({ id: 'ADMIN-001', studentId: '', name: 'Sports Custodian', username: 'admin', passwordHash: hashPassword('admin123'), role: 'admin', course: '', yearLevel: '', createdAt: nowIso() });
}
function initData() {
  ensureDemoAdmin();
  // Sample equipment is created ONLY when no valid inventory data exists.
  let valid = false;
  try { valid = Array.isArray(JSON.parse(localStorage.getItem(KEYS.equipment))); } catch (e) { valid = false; }
  if (!valid) {
    const list = [];
    SAMPLE_EQUIPMENT.forEach((s) => {
      list.push({
        id: nextId('eq', list), name: s[0], category: s[1], description: s[2],
        totalQty: s[3], availableQty: s[3], borrowedQty: 0, unusableQty: 0,
        condition: s[4], status: 'Available', image: pictureFor(s[0])
      });
    });
    saveList(KEYS.equipment, list);
  }
  repairSamplePictures();
}
// One-time repair for inventory saved by an older version (runs once, flag below).
//  1. The old generic "Sports Net" record is changed into "Volleyball Net" (same record, same quantity, history kept) and the missing
//     Soccer Net, Table Tennis Net and Takraw records are added, because those nets replace the old one.
//  2. Items whose picture is empty or points to a file that no longer exists get the matching new picture (matched by exact name).
// Uploaded pictures are never touched, and a picture the Admin removes later stays removed.
const PIC_FIX_FLAG = 'vci_sample_repaired_v3';
const OLD_NAME_ALIASES = { 'football': 'soccer ball', 'sepak takraw ball': 'takraw', 'sepak takraw': 'takraw' };
function repairSamplePictures() {
  try {
    if (localStorage.getItem(PIC_FIX_FLAG) || typeof document === 'undefined') return;
    const presets = presetImages(); if (!presets.length) return;           // picture list not on the page yet: try again next time
    const list = loadList(KEYS.equipment); let changed = 0;
    const has = (n) => list.some((e) => String(e.name).toLowerCase() === n.toLowerCase());
    const oldNet = list.find((e) => String(e.name).toLowerCase() === 'sports net');
    if (oldNet && !has('Volleyball Net')) {
      oldNet.name = 'Volleyball Net'; if (oldNet.category === 'Other Sports') oldNet.category = 'Volleyball';
      if (/adjustable net/i.test(oldNet.description || '')) oldNet.description = 'Volleyball net with posts for the court.';
      oldNet.image = ''; changed++;
      [['Soccer Net', 'Football', 'Soccer goal net.', 2], ['Table Tennis Net', 'Table Tennis', 'Clamp-on table tennis net set.', 2], ['Takraw', 'Sepak Takraw', 'Woven rattan takraw ball.', 6]].forEach((n) => {
        if (has(n[0])) return;
        list.push({ id: nextId('eq', list), name: n[0], category: n[1], description: n[2], totalQty: n[3], availableQty: n[3], borrowedQty: 0, unusableQty: 0, condition: 'Good', status: 'Available', image: '', createdAt: nowIso() });
        changed++;
      });
    }
    list.forEach((e) => {
      const key = String(e.name).toLowerCase(), cur = e.image || '';
      const hit = presets.find((p) => p.label.toLowerCase() === (OLD_NAME_ALIASES[key] || key));
      if (/^data:image\//.test(cur) || presets.some((p) => p.path === cur)) return;       // uploaded or already a current picture
      const next = hit ? hit.path : '';                                                       // no matching picture: leave it empty (placeholder)
      if (next !== cur) { e.image = next; changed++; }
    });
    if (changed) saveList(KEYS.equipment, list);
    localStorage.setItem(PIC_FIX_FLAG, '1');
  } catch (err) { /* storage unavailable: nothing to repair */ }
}
function resetDemoData() {
  if (!requireAdmin().ok) return;
  const admins = getAccounts().filter((a) => a.role === 'admin');    // the Admin account and its password are kept
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  saveList(KEYS.accounts, admins);
  initData();
}

/* ----- Accounts & session ----- */
function getAccounts() { return loadList(KEYS.accounts); }
function findAccountByUsername(username) {
  const u = String(username || '').trim().toLowerCase();
  return getAccounts().find((a) => String(a.username).toLowerCase() === u) || null;
}
function saveAccount(account) {
  const list = getAccounts();
  const i = list.findIndex((a) => a.id === account.id);
  if (i >= 0) list[i] = account; else list.push(account);
  return saveList(KEYS.accounts, list);
}
function hasAdminAccount() { return getAccounts().some((a) => a.role === 'admin'); }
// First-run setup. This works ONLY while no Admin account exists, and no password is written anywhere in the code:
// the person setting up the system chooses it. The username is always "admin".
function createInitialAdmin(d) {
  if (hasAdminAccount()) return fail('An Admin account already exists.');
  const e = {}, name = String(d.name || '').trim();
  if (!name) e.name = 'Enter the administrator\'s full name.';
  else if (name.length > 60) e.name = 'Name is too long (60 characters maximum).';
  validateNewPassword(d, e);
  if (Object.keys(e).length) return fail('Please fix the highlighted fields.', e);
  const acc = { id: 'ADMIN-001', studentId: '', name, username: 'admin', passwordHash: hashPassword(d.newPassword), role: 'admin', course: '', yearLevel: '', createdAt: nowIso() };
  if (!saveAccount(acc)) return fail('Could not save the account. Browser storage may be full.');
  return ok(acc);
}
function validateRegistration(d) {
  const e = {};
  const sid = String(d.studentId || '').trim();
  const name = String(d.name || '').trim().replace(/\s+/g, ' ');
  const course = String(d.course || '').trim();
  const user = String(d.username || '').trim();
  const accounts = getAccounts();
  if (!sid) e.studentId = 'Enter your Student ID.';
  else if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,19}$/.test(sid)) e.studentId = 'Student ID must be 3-20 characters: letters, numbers or hyphens.';
  else if (accounts.some((a) => a.role === 'student' && String(a.studentId).toLowerCase() === sid.toLowerCase())) e.studentId = 'This Student ID is already registered.';
  if (!name) e.name = 'Enter your complete name.';
  else if (name.length < 5 || !/^\p{L}[\p{L}\s.,'-]*$/u.test(name)) e.name = 'Use letters only (spaces, periods, commas and hyphens are allowed), at least 5 characters.';
  if (!course) e.course = 'Enter your course.';
  else if (course.length > 40) e.course = 'Course is too long.';
  if (!YEAR_LEVELS.includes(d.yearLevel)) e.yearLevel = 'Select your year level.';
  if (!user) e.username = 'Choose a username.';
  else if (!/^[A-Za-z0-9_.]{4,20}$/.test(user)) e.username = 'Username must be 4-20 characters: letters, numbers, _ or .';
  else if (['admin', 'administrator', 'custodian'].includes(user.toLowerCase())) e.username = 'This username is reserved. Choose another.';
  else if (accounts.some((a) => String(a.username).toLowerCase() === user.toLowerCase())) e.username = 'This username is already taken.';
  if (!d.password) e.password = 'Enter a password.';
  else if (d.password.length < MIN_PASSWORD) e.password = 'Password must be at least ' + MIN_PASSWORD + ' characters.';
  else if (d.password.length > 64) e.password = 'Password is too long (64 characters maximum).';
  if (!d.confirmPassword) e.confirmPassword = 'Confirm your password.';
  else if (d.password !== d.confirmPassword) e.confirmPassword = 'Passwords do not match.';
  return e;
}
function registerStudent(d) {
  const errors = validateRegistration(d);
  if (Object.keys(errors).length) return fail('Please fix the highlighted fields.', errors);
  const account = {
    id: 'STU-' + String(d.studentId).trim().toUpperCase(),
    studentId: String(d.studentId).trim(),
    name: String(d.name).trim().replace(/\s+/g, ' '),
    course: String(d.course).trim(), yearLevel: d.yearLevel,
    username: String(d.username).trim(),
    passwordHash: hashPassword(d.password),
    role: 'student',                       // students can never become admins
    createdAt: nowIso()
  };
  if (!saveAccount(account)) return fail('Could not save the account. Browser storage may be full or blocked.');
  return ok(account);
}
/* Failed-login counter: after MAX_LOGIN_FAILS wrong attempts the username is locked for a few minutes.
   Unknown usernames are counted too, so the screen never reveals which usernames exist. */
function lockoutRemaining(key) {
  const g = loadObject(KEYS.guard)[key];
  return g && g.until && g.until > Date.now() ? g.until - Date.now() : 0;
}
function recordFailure(key) {
  const all = loadObject(KEYS.guard);
  const g = all[key] || { fails: 0, until: 0 };
  if (g.until && g.until <= Date.now()) { g.fails = 0; g.until = 0; }
  g.fails += 1;
  if (g.fails >= MAX_LOGIN_FAILS) { g.until = Date.now() + LOCKOUT_MS; g.fails = 0; }
  all[key] = g; saveList(KEYS.guard, all);
}
function clearFailures(key) {
  const all = loadObject(KEYS.guard);
  if (all[key]) { delete all[key]; saveList(KEYS.guard, all); }
}
function lockMessage(ms) { return 'Too many failed attempts. Try again in ' + Math.max(1, Math.ceil(ms / 60000)) + ' minute(s).'; }

function login(username, password) {
  const key = String(username || '').trim().toLowerCase();
  const wait = lockoutRemaining(key);
  if (wait) return fail(lockMessage(wait));
  const acc = findAccountByUsername(username);
  if (!acc || acc.passwordHash !== hashPassword(password)) {
    recordFailure(key);
    const w = lockoutRemaining(key);
    return fail(w ? lockMessage(w) : 'Incorrect username or password.');
  }
  clearFailures(key);
  const t = Date.now();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ accountId: acc.id, loginAt: t, lastActive: t }));
  return ok(acc);
}
function currentUser() {
  try {
    const sess = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (!sess) return null;
    if (Date.now() - (sess.lastActive || 0) > SESSION_IDLE_MS) { logout(); return null; }   // idle session expired
    const acc = getAccounts().find((a) => a.id === sess.accountId) || null;
    if (!acc) { logout(); return null; }
    sess.lastActive = Date.now();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    return acc;
  } catch (e) { return null; }
}
function logout() { sessionStorage.removeItem(SESSION_KEY); }

/* Role guards. Every service function that changes data calls one of these FIRST, so a student cannot
   run an admin action just by calling the function from the browser console. (In a real deployment the
   same checks run on the server.) */
function requireUser() { const u = currentUser(); return u ? ok(u) : fail('Your session has ended. Please log in again.'); }
function requireAdmin() { const u = currentUser(); return u && u.role === 'admin' ? ok(u) : fail('Administrator access is required.'); }
function requireStudent() { const u = currentUser(); return u && u.role === 'student' ? ok(u) : fail('Only students can do this.'); }

/* ----- Admin password: change and recovery -----
   The default Admin password is never changed or replaced by the system. The Admin can change it, and can
   generate a one-time recovery code (shown once, kept only as a hash) to reset a forgotten password. */
function validateNewPassword(d, e) {
  if (!d.newPassword) e.newPassword = 'Enter a new password.';
  else if (d.newPassword.length < MIN_ADMIN_PASSWORD) e.newPassword = 'Use at least ' + MIN_ADMIN_PASSWORD + ' characters.';
  else if (d.newPassword.length > 64) e.newPassword = 'Password is too long (64 characters maximum).';
  if (!d.confirmPassword) e.confirmPassword = 'Confirm the new password.';
  else if (d.newPassword !== d.confirmPassword) e.confirmPassword = 'Passwords do not match.';
}
function changeAdminPassword(d) {
  const g = requireAdmin(); if (!g.ok) return g;
  const wait = lockoutRemaining('pwchange');
  if (wait) return fail(lockMessage(wait));
  const acc = g.data, e = {};
  if (acc.passwordHash !== hashPassword(d.currentPassword || '')) { recordFailure('pwchange'); e.currentPassword = 'Current password is incorrect.'; }
  validateNewPassword(d, e);
  if (!e.newPassword && d.newPassword === d.currentPassword) e.newPassword = 'The new password must be different from the current one.';
  if (Object.keys(e).length) return fail('Please fix the highlighted fields.', e);
  clearFailures('pwchange');
  acc.passwordHash = hashPassword(d.newPassword); acc.passwordChangedAt = nowIso();
  if (!saveAccount(acc)) return fail('Could not save the new password. Browser storage may be full.');
  return ok(true);
}
function newRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I to avoid misreading
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  bytes.forEach((b, i) => { out += alphabet[b % alphabet.length]; if (i % 4 === 3 && i < 15) out += '-'; });
  return out;
}
function generateRecoveryCode(currentPassword) {
  const g = requireAdmin(); if (!g.ok) return g;
  const wait = lockoutRemaining('pwchange');
  if (wait) return fail(lockMessage(wait));
  const acc = g.data;
  if (acc.passwordHash !== hashPassword(currentPassword || '')) { recordFailure('pwchange'); return fail('Please fix the highlighted fields.', { currentPassword: 'Current password is incorrect.' }); }
  clearFailures('pwchange');
  const code = newRecoveryCode();
  acc.recoveryHash = hashPassword('recovery|' + code); acc.recoveryCreatedAt = nowIso();   // only the hash is stored
  if (!saveAccount(acc)) return fail('Could not save the recovery code. Browser storage may be full.');
  return ok(code);
}
function resetPasswordWithRecoveryCode(d) {
  const wait = lockoutRemaining('recovery');
  if (wait) return fail(lockMessage(wait));
  const e = {};
  const code = String(d.code || '').trim().toUpperCase();
  if (!code) e.code = 'Enter your recovery code.';
  validateNewPassword(d, e);
  if (Object.keys(e).length) return fail('Please fix the highlighted fields.', e);
  const acc = getAccounts().find((a) => a.role === 'admin');
  if (!acc || !acc.recoveryHash || acc.recoveryHash !== hashPassword('recovery|' + code)) {
    recordFailure('recovery');
    const w = lockoutRemaining('recovery');
    return fail(w ? lockMessage(w) : 'That recovery code is not valid, or it was already used.', { code: 'Invalid recovery code.' });
  }
  acc.passwordHash = hashPassword(d.newPassword); acc.passwordChangedAt = nowIso();
  acc.recoveryHash = '';                                   // a recovery code works only once
  if (!saveAccount(acc)) return fail('Could not save the new password. Browser storage may be full.');
  clearFailures('recovery'); clearFailures(String(acc.username).toLowerCase());
  return ok(true);
}
/* ----- Student password: forgotten, reset by the Admin, change by the student -----
   A student who forgot the password asks the Admin (Sports Custodian). The Admin creates a temporary password
   (shown once, stored only as a scrambled hash). The student must choose a new password at the next login. */
function tempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';   // no look-alike characters (0/O, 1/l/I)
  const bytes = new Uint8Array(8); crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join('');
}
function getStudentAccounts() { return getAccounts().filter((a) => a.role === 'student'); }
function resetStudentPassword(accountId) {
  const g = requireAdmin(); if (!g.ok) return g;
  const acc = getAccounts().find((a) => a.id === accountId && a.role === 'student');
  if (!acc) return fail('Student account not found.');
  const pw = tempPassword();
  acc.passwordHash = hashPassword(pw); acc.mustChangePassword = true; acc.passwordChangedAt = nowIso();
  if (!saveAccount(acc)) return fail('Could not save the new password. Browser storage may be full.');
  clearFailures(String(acc.username).toLowerCase());                 // also lifts a "too many attempts" lock-out
  logTransaction('Student password reset', { req: { id: '', studentId: acc.studentId, studentName: acc.name, equipmentId: '—', equipmentName: '—', quantity: 0 }, qty: 0, status: 'Reset', notes: 'Temporary password issued by ' + g.data.name + '. The student must choose a new one at the next login.' });
  return ok({ password: pw, account: acc });
}
function changeStudentPassword(d) {
  const g = requireStudent(); if (!g.ok) return g;
  const acc = g.data, key = 'pwchange-' + acc.id, e = {};
  const wait = lockoutRemaining(key);
  if (wait) return fail(lockMessage(wait));
  if (acc.passwordHash !== hashPassword(d.currentPassword || '')) { recordFailure(key); e.currentPassword = 'Current (or temporary) password is incorrect.'; }
  if (!d.newPassword) e.newPassword = 'Enter a new password.';
  else if (d.newPassword.length < MIN_PASSWORD) e.newPassword = 'Password must be at least ' + MIN_PASSWORD + ' characters.';
  else if (d.newPassword.length > 64) e.newPassword = 'Password is too long (64 characters maximum).';
  else if (d.newPassword === d.currentPassword) e.newPassword = 'The new password must be different from the current one.';
  if (!d.confirmPassword) e.confirmPassword = 'Confirm the new password.';
  else if (d.newPassword !== d.confirmPassword) e.confirmPassword = 'Passwords do not match.';
  if (Object.keys(e).length) return fail('Please fix the highlighted fields.', e);
  clearFailures(key);
  acc.passwordHash = hashPassword(d.newPassword); acc.mustChangePassword = false; acc.passwordChangedAt = nowIso();
  if (!saveAccount(acc)) return fail('Could not save the new password. Browser storage may be full.');
  return ok(true);
}
function homeFor(user) { return user.role === 'admin' ? 'admin' : 'student'; }   // route name

/* ----- Equipment ----- */
function normalizeEquipment(e) {
  const n = (v) => Math.max(0, parseInt(v, 10) || 0);
  return Object.assign({}, e, {
    totalQty: n(e.totalQty), availableQty: n(e.availableQty), borrowedQty: n(e.borrowedQty), unusableQty: n(e.unusableQty),
    status: EQUIP_STATUSES.includes(e.status) ? e.status : 'Available',
    condition: EQUIP_CONDITIONS.includes(e.condition) ? e.condition : 'Good',
    image: e.image && e.image !== 'images/equipment-placeholder.png' ? e.image : '', name: e.name || '(unnamed)', category: e.category || 'Other', description: e.description || ''
  });
}
function getEquipment() { return loadList(KEYS.equipment).map(normalizeEquipment); }
function getEquipmentById(id) { return getEquipment().find((e) => e.id === id) || null; }
function saveEquipment(eq) {
  const list = loadList(KEYS.equipment);
  const i = list.findIndex((x) => x.id === eq.id);
  if (i >= 0) list[i] = eq; else list.push(eq);
  return saveList(KEYS.equipment, list);
}
// Stock that can actually be borrowed right now. Damaged / under-repair / unavailable items count as 0.
function borrowableQty(eq) { return eq.status === 'Available' ? Math.max(0, eq.availableQty) : 0; }
function stockLabel(eq) {
  if (eq.status !== 'Available') return eq.status;
  if (eq.availableQty <= 0) return 'Out of Stock';
  if (eq.availableQty <= LOW_STOCK_LIMIT) return 'Low Stock';
  return 'Available';
}
// Tidy a typed category and reuse the existing spelling, so "basketball", "Basketball " and "BASKETBALL" are one category.
function cleanCategory(raw) {
  const c = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!c) return '';
  const known = SPORT_CATEGORIES.concat(loadList(KEYS.equipment).map((x) => String(x.category || '')));
  return known.find((k) => k.toLowerCase() === c.toLowerCase()) || c.charAt(0).toUpperCase() + c.slice(1);
}
// The suggested categories first, then any custom category that is already used by equipment.
function allCategories() {
  const extra = [];
  loadList(KEYS.equipment).forEach((x) => {
    const c = String(x.category || '').trim();
    if (c && !SPORT_CATEGORIES.concat(extra).some((k) => k.toLowerCase() === c.toLowerCase())) extra.push(c);
  });
  return SPORT_CATEGORIES.concat(extra.sort());
}
function validateEquipment(d, existing) {
  const e = {};
  const name = String(d.name || '').trim();
  if (!name) e.name = 'Enter the equipment name.'; else if (name.length > 60) e.name = 'Name is too long (60 characters maximum).';
  const cat = cleanCategory(d.category);
  if (!cat) e.category = 'Choose a category, or add a custom one.';
  else if (cat.length > 40) e.category = 'Category is too long (40 characters maximum).';
  else if (!/^[A-Za-z0-9][A-Za-z0-9 &'\/.,()-]*$/.test(cat)) e.category = 'Use letters, numbers and simple punctuation only.';
  const img = String(d.image || '');
  if (img && !/^images\/[A-Za-z0-9._ -]{1,80}$/.test(img) && !/^data:image\/(jpeg|png|webp|gif);base64,/.test(img)) e.image = 'That picture is not valid.';
  if (String(d.description || '').length > 300) e.description = 'Description is too long (300 characters maximum).';
  if (!isInt(d.totalQty) || +d.totalQty < 1 || +d.totalQty > 9999) e.totalQty = 'Total quantity must be a whole number from 1 to 9999.';
  if (!isInt(d.unusableQty)) e.unusableQty = 'Enter 0 or a whole number.';
  if (!EQUIP_CONDITIONS.includes(d.condition)) e.condition = 'Select a condition.';
  if (!EQUIP_STATUSES.includes(d.status)) e.status = 'Select a status.';
  if (!e.totalQty && !e.unusableQty) {
    const borrowed = existing ? existing.borrowedQty : 0;
    if (+d.totalQty < borrowed) e.totalQty = 'Total quantity cannot be less than the ' + borrowed + ' unit(s) currently borrowed.';
    else if (+d.unusableQty + borrowed > +d.totalQty) e.unusableQty = 'Damaged/repair units plus borrowed units (' + borrowed + ') cannot exceed the total quantity.';
  }
  return e;
}
function addEquipment(d) {
  const guard = requireAdmin(); if (!guard.ok) return guard;
  const errors = validateEquipment(d, null);
  if (Object.keys(errors).length) return fail('Please fix the highlighted fields.', errors);
  const list = loadList(KEYS.equipment);
  const eq = {
    id: nextId('eq', list), name: d.name.trim(), category: cleanCategory(d.category), description: (d.description || '').trim(),
    totalQty: +d.totalQty, unusableQty: +d.unusableQty, borrowedQty: 0,
    availableQty: +d.totalQty - +d.unusableQty, condition: d.condition, status: d.status, image: d.image || ''
  };
  if (!saveEquipment(eq)) return fail('Could not save. Browser storage may be full (try a smaller image).');
  logTransaction('Inventory added', { eq, qty: eq.totalQty, status: eq.status, notes: 'New equipment added with ' + eq.totalQty + ' unit(s).' });
  return ok(eq);
}
function updateEquipment(id, d) {
  const guard = requireAdmin(); if (!guard.ok) return guard;
  const old = getEquipmentById(id);
  if (!old) return fail('Equipment not found.');
  const errors = validateEquipment(d, old);
  if (Object.keys(errors).length) return fail('Please fix the highlighted fields.', errors);
  const eq = Object.assign({}, old, {
    name: d.name.trim(), category: cleanCategory(d.category), description: (d.description || '').trim(),
    totalQty: +d.totalQty, unusableQty: +d.unusableQty, condition: d.condition, status: d.status, image: d.image === undefined ? old.image : (d.image || '')
  });
  eq.availableQty = eq.totalQty - eq.borrowedQty - eq.unusableQty;   // stock invariant: total = available + borrowed + unusable
  if (!saveEquipment(eq)) return fail('Could not save. Browser storage may be full (try a smaller image).');
  const changes = [];
  [['name', 'Name'], ['category', 'Category'], ['totalQty', 'Total'], ['unusableQty', 'Damaged/repair units'], ['condition', 'Condition'], ['status', 'Status']]
    .forEach(([k, label]) => { if (old[k] !== eq[k]) changes.push(label + ': ' + old[k] + ' → ' + eq[k]); });
  if (old.image !== eq.image) changes.push('Image changed');
  if (old.description !== eq.description) changes.push('Description changed');
  if (changes.length) logTransaction('Inventory updated', { eq, qty: eq.totalQty, status: eq.status, notes: changes.join('; ') });
  if (old.status !== eq.status && eq.status === 'Damaged') logTransaction('Equipment marked damaged', { eq, qty: eq.totalQty, status: eq.status, notes: 'Item status set to Damaged.' });
  if (old.status !== eq.status && eq.status === 'Under Repair') logTransaction('Equipment marked under repair', { eq, qty: eq.totalQty, status: eq.status, notes: 'Item status set to Under Repair.' });
  return ok(eq);
}
function equipmentHasActiveRequests(id) {
  return getBorrowingRequests().some((r) => r.equipmentId === id && ['Pending', 'Approved', 'Borrowed', 'Overdue'].includes(r.status));
}
function canDeleteEquipment(eq) {
  if (eq.borrowedQty > 0) return fail('Cannot delete: ' + eq.borrowedQty + ' unit(s) are currently borrowed.');
  if (equipmentHasActiveRequests(eq.id)) return fail('Cannot delete: there are pending, approved or borrowed requests for this equipment.');
  return ok(true);
}
function deleteEquipment(id) {
  const guard = requireAdmin(); if (!guard.ok) return guard;
  const eq = getEquipmentById(id);
  if (!eq) return fail('Equipment not found.');
  const check = canDeleteEquipment(eq);
  if (!check.ok) return check;
  saveList(KEYS.equipment, loadList(KEYS.equipment).filter((x) => x.id !== id));
  logTransaction('Inventory deleted', { eq, qty: eq.totalQty, status: 'Deleted', notes: 'Equipment record removed.' });
  return ok(true);
}

/* ----- Borrowing requests ----- */
function getBorrowingRequests() { return loadList(KEYS.requests); }
function getRequestById(id) { return getBorrowingRequests().find((r) => r.id === id) || null; }
// A logged-in student can only ever read their own records, even if another Student ID is passed in.
function otherStudentBlocked(studentId) { const u = currentUser(); return !!u && u.role === 'student' && u.studentId !== studentId; }
function getRequestsForStudent(studentId) { return otherStudentBlocked(studentId) ? [] : getBorrowingRequests().filter((r) => r.studentId === studentId); }
function saveBorrowingRequest(req) {
  const list = getBorrowingRequests();
  const i = list.findIndex((r) => r.id === req.id);
  if (i >= 0) list[i] = req; else list.push(req);
  return saveList(KEYS.requests, list);
}
function outstandingQty(r) { return Math.max(0, (r.quantity || 0) - (r.returnedQty || 0)); }
function validateBorrowRequest(d, eq) {
  const e = {};
  const today = todayStr();
  if (!eq) { e.general = 'Equipment not found.'; return e; }
  if (borrowableQty(eq) <= 0) e.general = 'This equipment is not available for borrowing right now (' + stockLabel(eq) + ').';
  if (!isInt(d.quantity) || +d.quantity < 1) e.quantity = 'Quantity must be a whole number greater than 0.';
  else if (+d.quantity > borrowableQty(eq)) e.quantity = 'Only ' + borrowableQty(eq) + ' unit(s) are available.';
  if (!d.borrowDate) e.borrowDate = 'Select the borrowing date.';
  else if (d.borrowDate < today) e.borrowDate = 'Borrowing date cannot be in the past.';
  if (!d.returnDate) e.returnDate = 'Select the expected return date.';
  else if (d.borrowDate && d.returnDate < d.borrowDate) e.returnDate = 'Return date cannot be earlier than the borrowing date.';
  if (String(d.purpose || '').trim().length < 5) e.purpose = 'Enter a purpose (at least 5 characters).';
  else if (d.purpose.length > 200) e.purpose = 'Purpose is too long (200 characters maximum).';
  return e;
}
function submitBorrowingRequest(student, d) {
  const guard = requireStudent();
  if (!guard.ok) return fail('Only students can submit borrowing requests.');
  student = guard.data;      // identity always comes from the session, never from the caller
  const eq = getEquipmentById(d.equipmentId);
  const errors = validateBorrowRequest(d, eq);
  if (Object.keys(errors).length) return fail(errors.general || 'Please fix the highlighted fields.', errors);
  const list = getBorrowingRequests();
  // Duplicate-submission guard: the same student cannot send an identical request that is still waiting (double click, refresh and resend).
  const same = list.find((x) => x.studentId === student.studentId && x.equipmentId === eq.id && ['Pending', 'Approved'].includes(x.status) &&
    x.quantity === +d.quantity && x.borrowDate === d.borrowDate && x.returnDate === d.returnDate);
  if (same) return fail('You already sent this same request (' + same.id + '). Please wait for the custodian to review it.');
  const req = {
    id: nextId('req', list), studentId: student.studentId, studentName: student.name,
    course: student.course + ' ' + student.yearLevel,
    equipmentId: eq.id, equipmentName: eq.name, quantity: +d.quantity,
    borrowDate: d.borrowDate, returnDate: d.returnDate, purpose: d.purpose.trim(),
    status: 'Pending', createdAt: nowIso(), returnedQty: 0,
    rejectReason: '', issueDate: '', dueDate: '', returnedAt: ''
  };
  if (!saveBorrowingRequest(req)) return fail('Could not save the request. Browser storage may be full.');
  // NOTE: stock is NOT changed here. A pending request is only a request.
  logTransaction('Borrowing request submitted', { req, eq, status: 'Pending', notes: 'Purpose: ' + req.purpose });
  return ok(req);
}
function cancelRequest(id, student) {
  const r = getRequestById(id);
  if (!r) return fail('Request not found.');
  const guard = requireStudent();
  if (!guard.ok || r.studentId !== guard.data.studentId) return fail('You can only cancel your own requests.');
  if (r.status !== 'Pending') return fail('Only pending requests can be cancelled.');
  r.status = 'Cancelled'; r.cancelledAt = nowIso();
  saveBorrowingRequest(r);
  logTransaction('Request cancelled', { req: r, status: 'Cancelled', notes: 'Cancelled by student.' });
  return ok(r);
}
function approveRequest(id) {
  const guard = requireAdmin(); if (!guard.ok) return guard;
  const r = getRequestById(id);
  if (!r) return fail('Request not found.');
  if (r.status !== 'Pending') return fail('Only pending requests can be approved (current status: ' + r.status + ').');
  const eq = getEquipmentById(r.equipmentId);
  if (!eq || borrowableQty(eq) < r.quantity) return fail('Not enough borrowable stock to approve this request right now.');
  r.status = 'Approved'; r.approvedAt = nowIso();
  saveBorrowingRequest(r);                                   // approval does NOT deduct stock
  logTransaction('Request approved', { req: r, eq, status: 'Approved', notes: 'Approved. Stock will be deducted when the equipment is issued.' });
  return ok(r);
}
function rejectRequest(id, reason) {
  const guard = requireAdmin(); if (!guard.ok) return guard;
  const r = getRequestById(id);
  if (!r) return fail('Request not found.');
  if (!['Pending', 'Approved'].includes(r.status)) return fail('Only pending or approved requests can be rejected.');
  if (String(reason || '').trim().length < 3) return fail('Enter a reason for rejecting the request.', { reason: 'Enter a reason (at least 3 characters).' });
  r.status = 'Rejected'; r.rejectReason = reason.trim(); r.rejectedAt = nowIso();
  saveBorrowingRequest(r);
  logTransaction('Request rejected', { req: r, status: 'Rejected', notes: 'Reason: ' + r.rejectReason });
  return ok(r);
}
// Marks requests Overdue (or back to Borrowed) based on today's date. Fully returned requests are never overdue.
function refreshOverdue() {
  const list = getBorrowingRequests();
  const today = todayStr();
  let changed = false;
  list.forEach((r) => {
    if (r.status !== 'Borrowed' && r.status !== 'Overdue') return;
    let next = r.status;
    if (outstandingQty(r) <= 0) next = 'Returned';
    else next = r.dueDate && r.dueDate < today ? 'Overdue' : 'Borrowed';
    if (next !== r.status) { r.status = next; changed = true; }
  });
  if (changed) saveList(KEYS.requests, list);
}

/* ----- Issuing and returning ----- */
function getIssuances() { return loadList(KEYS.issuances); }
function getReturns() { return loadList(KEYS.returns); }
function issueEquipment(id, d) {
  const guard = requireAdmin(); if (!guard.ok) return guard;
  const r = getRequestById(id);
  if (!r) return fail('Request not found.');
  if (r.status !== 'Approved' || r.issueDate) return fail('Only approved requests that have not been issued can be issued (current status: ' + r.status + ').');
  const eq = getEquipmentById(r.equipmentId);
  if (!eq) return fail('Equipment record no longer exists.');
  const errors = {};
  const today = todayStr();
  if (!d.issueDate) errors.issueDate = 'Select the actual issue date.';
  else if (d.issueDate > today) errors.issueDate = 'Issue date cannot be in the future.';
  if (!d.dueDate) errors.dueDate = 'Select the expected return date.';
  else if (d.issueDate && d.dueDate < d.issueDate) errors.dueDate = 'Return date cannot be earlier than the issue date.';
  if (Object.keys(errors).length) return fail('Please fix the highlighted fields.', errors);
  if (eq.status !== 'Available') return fail('This equipment is marked "' + eq.status + '" and cannot be issued.');
  if (eq.availableQty < r.quantity) return fail('Not enough stock to issue. Available: ' + eq.availableQty + ', requested: ' + r.quantity + '.');
  // Stock is deducted here, exactly once (the status check above blocks a second issue).
  eq.availableQty -= r.quantity; eq.borrowedQty += r.quantity;
  if (!saveEquipment(eq)) return fail('Could not update stock. Browser storage may be full.');
  r.status = d.dueDate < today ? 'Overdue' : 'Borrowed';
  r.issueDate = d.issueDate; r.dueDate = d.dueDate; r.issuedAt = nowIso(); r.returnedQty = 0;
  saveBorrowingRequest(r);
  const issues = getIssuances();
  issues.push({ id: nextId('iss', issues), requestId: r.id, studentId: r.studentId, studentName: r.studentName, equipmentId: eq.id, equipmentName: eq.name, quantity: r.quantity, issueDate: r.issueDate, dueDate: r.dueDate, issuedAt: r.issuedAt });
  saveList(KEYS.issuances, issues);
  logTransaction('Equipment issued', { req: r, eq, status: r.status, notes: 'Issued ' + fmtDate(r.issueDate) + ', due ' + fmtDate(r.dueDate) + '.' });
  return ok(r);
}
function validateReturn(r, d) {
  const e = {};
  const out = outstandingQty(r);
  const today = todayStr();
  if (!isInt(d.qty) || +d.qty < 1) e.qty = 'Returned quantity must be a whole number greater than 0.';
  else if (+d.qty > out) e.qty = 'Cannot return more than the ' + out + ' unit(s) still outstanding.';
  if (!d.date) e.date = 'Select the actual return date.';
  else if (d.date > today) e.date = 'Return date cannot be in the future.';
  else if (r.issueDate && d.date < r.issueDate) e.date = 'Return date cannot be earlier than the issue date (' + fmtDate(r.issueDate) + ').';
  if (!RETURN_CONDITIONS.includes(d.condition)) e.condition = 'Select the condition of the returned equipment.';
  else if (d.condition !== 'Good' && String(d.notes || '').trim().length < 3) e.notes = 'Add a note describing the damage or repair needed.';
  if (String(d.notes || '').length > 300) e.notes = 'Notes are too long (300 characters maximum).';
  return e;
}
/* ----- Returns -----
   Two ways a return happens:
   1) The student presses Return  -> a record with status "Pending Verification" is saved and the exact date and
      time are stamped. Stock does NOT change yet.
   2) The Admin inspects the equipment and confirms (confirmReturn) -> only now does stock change, and only
      Good-condition units go back to Available. The Admin can also refuse a return (rejectReturn).
   The Admin can still record a return directly at the counter (recordReturn).
   Return records saved before verification existed have no status and count as Confirmed. */
function retStatus(h) { return h.status || 'Confirmed'; }
function pendingReturns() { return getReturns().filter((h) => retStatus(h) === 'Pending Verification'); }
function pendingReturnFor(requestId) { return pendingReturns().find((h) => h.requestId === requestId) || null; }

function validateReturnCheck(d, e) {
  if (!RETURN_CONDITIONS.includes(d.condition)) e.condition = 'Select the condition of the returned equipment.';
  else if (d.condition !== 'Good' && String(d.notes || '').trim().length < 3) e.notes = 'Add a note describing the damage or repair needed.';
  if (String(d.notes || '').length > 300) e.notes = 'Notes are too long (300 characters maximum).';
}

// Moves the stock and updates the borrowing record. Used by the Admin's direct return and by return verification.
function applyReturn(r, qty, condition, date, notes, rec) {
  const eq = getEquipmentById(r.equipmentId);
  if (eq) {
    eq.borrowedQty = Math.max(0, eq.borrowedQty - qty);
    if (condition === 'Good') eq.availableQty += qty;                    // only fit-for-use items go back on the shelf
    else { eq.unusableQty += qty; eq.condition = condition; }            // damaged / needs repair stays out of borrowable stock
    if (!saveEquipment(eq)) return fail('Could not update stock. Browser storage may be full.');
  }
  r.returnedQty = (r.returnedQty || 0) + qty;
  const complete = outstandingQty(r) === 0;
  if (complete) {
    r.status = 'Returned'; r.returnedAt = date;
    r.returnedAtTime = rec && rec.submittedAt ? rec.submittedAt : (date === todayStr() ? nowIso() : '');
  } else r.status = r.dueDate && r.dueDate < todayStr() ? 'Overdue' : 'Borrowed';
  saveBorrowingRequest(r);
  return ok({ eq, complete });
}
function logReturnTx(r, eq, qty, condition, rec, verifiedBy) {
  const complete = r.status === 'Returned';
  const note = qty + ' unit(s) returned in ' + condition + ' condition' + (complete ? '' : '; ' + outstandingQty(r) + ' still outstanding') +
    (rec.notes ? '. Notes: ' + rec.notes : '.') +
    (verifiedBy ? ' Verified by ' + verifiedBy + '.' : '');
  logTransaction(complete ? 'Equipment returned' : 'Partial return', { req: r, eq, qty, status: r.status, notes: note });
  if (condition === 'Damaged') logTransaction('Equipment marked damaged', { req: r, eq, qty, status: 'Damaged', notes: 'Excluded from available stock. ' + rec.notes });
  if (condition === 'Needs Repair') logTransaction('Equipment marked under repair', { req: r, eq, qty, status: 'Under Repair', notes: 'Excluded from available stock. ' + rec.notes });
}

// Student: "I no longer need this equipment." Allowed at any time while the equipment is out, even before the due date.
function submitReturn(id, d) {
  const g = requireStudent(); if (!g.ok) return g;
  const r = getRequestById(id);
  if (!r || r.studentId !== g.data.studentId) return fail('Borrowing record not found.');
  if (r.status !== 'Borrowed' && r.status !== 'Overdue') return fail('This borrowing record has no equipment to return (status: ' + r.status + ').');
  if (pendingReturnFor(r.id)) return fail('You already submitted a return for this record. Please wait for the administrator to verify it.');
  const out = outstandingQty(r), e = {};
  if (!isInt(d.qty) || +d.qty < 1) e.qty = 'Quantity must be a whole number greater than 0.';
  else if (+d.qty > out) e.qty = 'You only have ' + out + ' unit(s) to return.';
  validateReturnCheck(d, e);
  if (Object.keys(e).length) return fail('Please fix the highlighted fields.', e);
  const rets = getReturns();
  const rec = {
    id: nextId('ret', rets), requestId: r.id, studentId: r.studentId, studentName: r.studentName,
    equipmentId: r.equipmentId, equipmentName: r.equipmentName, quantity: +d.qty,
    returnDate: todayStr(), submittedAt: nowIso(),          // the system clock decides the actual return date and time
    condition: d.condition, notes: String(d.notes || '').trim(),
    status: 'Pending Verification', source: 'Student', remaining: out - +d.qty, recordedAt: nowIso()
  };
  rets.push(rec);
  if (!saveList(KEYS.returns, rets)) return fail('Could not save the return. Browser storage may be full.');
  logTransaction('Return submitted', { req: r, qty: rec.quantity, status: 'Pending Verification',
    notes: rec.quantity + ' unit(s) handed in as ' + rec.condition + '. Waiting for the administrator to verify.' + (rec.notes ? ' Notes: ' + rec.notes : '') });
  return ok(rec);
}
// Admin: inspect the equipment and confirm. This is the only moment stock changes for a student-submitted return.
function confirmReturn(retId, d) {
  const g = requireAdmin(); if (!g.ok) return g;
  const rets = getReturns();
  const rec = rets.find((x) => x.id === retId);
  if (!rec) return fail('Return record not found.');
  if (retStatus(rec) !== 'Pending Verification') return fail('This return was already ' + retStatus(rec).toLowerCase() + '.');   // blocks double confirmation
  const r = getRequestById(rec.requestId);
  if (!r || (r.status !== 'Borrowed' && r.status !== 'Overdue')) return fail('The borrowing record is no longer open.');
  if (rec.quantity > outstandingQty(r)) return fail('This return is larger than the ' + outstandingQty(r) + ' unit(s) still outstanding.');
  const e = {};
  validateReturnCheck(d, e);
  if (Object.keys(e).length) return fail('Please fix the highlighted fields.', e);
  const notes = String(d.notes || '').trim();
  const res = applyReturn(r, rec.quantity, d.condition, rec.returnDate, notes, rec);
  if (!res.ok) return res;
  rec.studentCondition = rec.condition; rec.studentNotes = rec.notes;
  rec.condition = d.condition; rec.notes = notes;
  rec.status = 'Confirmed'; rec.confirmedAt = nowIso(); rec.confirmedBy = g.data.name; rec.remaining = outstandingQty(r);
  if (!saveList(KEYS.returns, rets)) return fail('Stock was updated but the return record could not be saved. Browser storage may be full.');
  logReturnTx(r, res.data.eq, rec.quantity, d.condition, rec, g.data.name);
  return ok(r);
}
// Admin: the equipment never arrived (or is not what the student said). Stock is untouched; the student can submit again.
function rejectReturn(retId, reason) {
  const g = requireAdmin(); if (!g.ok) return g;
  const rets = getReturns();
  const rec = rets.find((x) => x.id === retId);
  if (!rec) return fail('Return record not found.');
  if (retStatus(rec) !== 'Pending Verification') return fail('This return was already ' + retStatus(rec).toLowerCase() + '.');
  if (String(reason || '').trim().length < 3) return fail('Enter a reason.', { reason: 'Enter a reason (at least 3 characters).' });
  if (String(reason).length > 300) return fail('The reason is too long.', { reason: 'Reason is too long (300 characters maximum).' });
  rec.status = 'Rejected'; rec.rejectReason = String(reason).trim(); rec.confirmedAt = nowIso(); rec.confirmedBy = g.data.name;
  if (!saveList(KEYS.returns, rets)) return fail('Could not save. Browser storage may be full.');
  logTransaction('Return not accepted', { req: getRequestById(rec.requestId), qty: rec.quantity, status: 'Rejected', notes: 'Reason: ' + rec.rejectReason + '. The equipment is still recorded as borrowed.' });
  return ok(rec);
}
// Admin: record equipment handed over at the counter (no student submission involved).
function recordReturn(id, d) {
  const g = requireAdmin(); if (!g.ok) return g;
  const r = getRequestById(id);
  if (!r) return fail('Request not found.');
  if (r.status !== 'Borrowed' && r.status !== 'Overdue') return fail('This request has no equipment waiting to be returned (status: ' + r.status + ').');
  if (pendingReturnFor(r.id)) return fail('The student already submitted a return for this request. Verify that return instead of recording a new one.');
  const errors = validateReturn(r, d);
  if (Object.keys(errors).length) return fail('Please fix the highlighted fields.', errors);
  const qty = +d.qty, notes = (d.notes || '').trim();
  const stamp = d.date === todayStr() ? nowIso() : '';
  const res = applyReturn(r, qty, d.condition, d.date, notes, { submittedAt: stamp });
  if (!res.ok) return res;
  const rets = getReturns();
  const rec = { id: nextId('ret', rets), requestId: r.id, studentId: r.studentId, studentName: r.studentName, equipmentId: r.equipmentId, equipmentName: r.equipmentName, quantity: qty, returnDate: d.date, submittedAt: stamp, condition: d.condition, notes, status: 'Confirmed', source: 'Admin', confirmedAt: nowIso(), confirmedBy: g.data.name, remaining: outstandingQty(r), recordedAt: nowIso() };
  rets.push(rec); saveList(KEYS.returns, rets);
  logReturnTx(r, res.data.eq, qty, d.condition, rec, '');
  return ok(r);
}

/* ----- Transactions ----- */
function getTransactions() { return loadList(KEYS.transactions); }
function logTransaction(action, o) {
  const list = getTransactions();
  const r = o.req, eq = o.eq;
  list.push({
    id: nextId('txn', list), datetime: nowIso(),
    studentId: r ? r.studentId : '—', studentName: r ? r.studentName : '—',
    equipmentId: eq ? eq.id : (r ? r.equipmentId : '—'), equipmentName: eq ? eq.name : (r ? r.equipmentName : '—'),
    quantity: o.qty != null ? o.qty : (r ? r.quantity : 0), action, status: o.status || '', notes: o.notes || '',
    requestId: r ? r.id : ''
  });
  saveList(KEYS.transactions, list);
}
function getTransactionsForStudent(studentId) { return otherStudentBlocked(studentId) ? [] : getTransactions().filter((t) => t.studentId === studentId); }

/* ---------------------------------------------------------
   4. UI HELPERS
   --------------------------------------------------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
let USER = null;   // the logged-in account for the current page

function toast(msg, type) {
  const box = $('#toasts'); if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' error' : ' success');
  t.innerHTML = '<span class="toast-icon">' + (type === 'error' ? '!' : '&#10003;') + '</span><span class="toast-text"></span>';
  $('.toast-text', t).textContent = msg;       // textContent keeps the message safe
  box.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
/* Simple line icons (inline SVG). To change one, edit its path text below. */
const ICON_PATHS = {
  home: 'M3 11 12 3l9 8 M5 9.5V21h14V9.5 M10 21v-6h4v6',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5V8z M3 8l9 5 9-5 M12 13v8',
  clipboard: 'M9 3h6v3H9z M7 5H5v16h14V5h-2 M9 12h6 M9 16h4',
  back: 'M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  logout: 'M9 21H5V3h4 M16 17l5-5-5-5 M21 12H9',
  check: 'M22 11.1V12a10 10 0 1 1-5.9-9.1 M22 4 12 14l-3-3',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.1 2 12v6h20v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z',
  alert: 'M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  report: 'M4 20V10 M10 20V4 M16 20v-8 M22 20H2'
};
function icon(name) {
  return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + (ICON_PATHS[name] || '') + '"/></svg>';
}
// A picture is shown only when the saved value looks like a real image file or an uploaded image.
function hasImage(src) {
  return typeof src === 'string' && (/^data:image\//.test(src) || /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(src));
}
// One summary card (used by both dashboards). href is optional: with it the whole card is a link.
function statCard(cls, iconName, num, label, caption, href) {
  const tag = href ? 'a' : 'div';
  return '<' + tag + ' class="stat ' + cls + '"' + (href ? ' href="' + href + '"' : '') + '><div class="stat-icon">' + icon(iconName) + '</div>' +
    '<div class="stat-text"><div class="num">' + num + '</div><div class="lbl">' + label + '</div><div class="cap">' + caption + '</div></div></' + tag + '>';
}
// Small availability bar for equipment cards (calculated from the real quantities).
function stockMeter(e) {
  const pct = e.totalQty > 0 ? Math.min(100, Math.round(borrowableQty(e) / e.totalQty * 100)) : 0;
  return '<div class="meter" title="' + pct + '% available"><span style="width:' + pct + '%"></span></div>';
}
function firstNameOf(name) {                 // "Melitante, Daryl G." -> "Daryl"
  const n = String(name || '').trim();
  const part = n.includes(',') ? n.split(',')[1].trim() : n;
  return part.split(/\s+/)[0] || n;
}
function badge(text) { return '<span class="badge b-' + slug(text) + '">' + esc(text) + '</span>'; }
const PLACEHOLDER_IMG = 'images/equipment-placeholder.png';
// Equipment picture. No picture, or a picture that fails to load, shows the local placeholder instead of a broken icon.
function imgTag(src, cls, alt) {
  const has = !!src;
  return '<img class="' + (cls || '') + (has ? '' : ' is-placeholder') + '" src="' + esc(has ? src : PLACEHOLDER_IMG) + '" alt="' + esc(alt || '') + '" onerror="imgFallback(this)">';
}
function imgFallback(img) {
  if (img.getAttribute('src') !== PLACEHOLDER_IMG) { img.setAttribute('src', PLACEHOLDER_IMG); img.classList.add('is-placeholder'); }
  else hideBrokenImage(img);                       // even the placeholder is missing: hide it rather than show a broken icon
}
function setErrors(root, errors) {
  $$('.error', root).forEach((el) => { el.textContent = ''; });
  $$('.invalid', root).forEach((el) => el.classList.remove('invalid'));
  let first = null;
  Object.keys(errors || {}).forEach((k) => {
    const el = $('.error[data-for="' + k + '"]', root);
    if (el) el.textContent = errors[k];
    const input = $('[name="' + k + '"]', root);
    if (input) { input.classList.add('invalid'); first = first || input; }
  });
  if (first) first.focus();
}
function formData(root) {
  const o = {};
  $$('input[name], select[name], textarea[name]', root).forEach((el) => { if (el.type !== 'file') o[el.name] = el.value; });
  return o;
}
function wirePasswordToggles(root) {
  $$('.pw-toggle', root).forEach((b) => b.addEventListener('click', () => {
    const input = $('#' + b.dataset.toggle);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show';
  }));
}

/* ----- Modal ----- */
let modalEl = null, modalKey = null;
function closeModal() {
  if (modalEl) { modalEl.remove(); modalEl = null; }
  if (modalKey) { document.removeEventListener('keydown', modalKey); modalKey = null; }
}
// actions: [{ label, cls, onClick(modalEl) -> return false to keep the modal open }]
function openModal(o) {
  closeModal();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = '<div class="modal ' + (o.wide ? 'wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
    '<div class="modal-head"><h3>' + esc(o.title) + '</h3><button class="modal-x" type="button" aria-label="Close">&times;</button></div>' +
    '<div class="modal-body">' + o.body + '</div>' +
    '<div class="modal-foot"></div></div>';
  const foot = $('.modal-foot', ov);
  (o.actions || []).forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn ' + (a.cls || ''); b.textContent = a.label;
    b.addEventListener('click', () => { if (a.onClick && a.onClick(ov) === false) return; if (!a.keepOpen) closeModal(); });
    foot.appendChild(b);
  });
  if (!(o.actions || []).length) foot.remove();
  if (o.locked) $('.modal-x', ov).remove();                 // a locked dialog must be completed (used for the forced password change)
  else $('.modal-x', ov).addEventListener('click', closeModal);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && !o.locked) closeModal(); });
  modalKey = (e) => { if (e.key === 'Escape' && !o.locked) closeModal(); };
  document.addEventListener('keydown', modalKey);
  document.body.appendChild(ov); modalEl = ov;
  const first = $('input:not([type=hidden]):not([type=file]), select, textarea', ov);
  if (first) first.focus();
  if (o.onOpen) o.onOpen(ov);
  return ov;
}
function confirmAction(o, onYes) {
  openModal({
    title: o.title || 'Please confirm',
    body: '<div class="confirm-box"><span class="confirm-icon' + (o.danger ? ' danger' : '') + '">' + (o.danger ? '!' : '?') + '</span><p>' + o.message + '</p></div>',
    actions: [
      { label: 'Cancel', cls: 'btn-ghost' },
      { label: o.confirmLabel || 'Confirm', cls: o.danger ? 'btn-danger solid' : 'btn-primary', onClick: () => { onYes(); } }
    ]
  });
}
function kv(pairs) {
  return '<dl class="kv">' + pairs.map((p) => '<dt>' + esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : esc(p[1] || '—')) + '</dd>').join('') + '</dl>';
}

function simpleTable(headers, rows) {
  if (!rows.length) return '<p class="empty">No records found.</p>';
  return '<table><thead><tr>' + headers.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}

/* ----- Page shell (sidebar + top bar) ----- */
function renderShell(user) {
  const page = document.body.dataset.page;
  const admin = user.role === 'admin';
  const waitingReturns = admin ? pendingReturns().length : 0;                       // student returns waiting for the admin
  // [link, label, page name, icon, small count shown next to the label]
  const links = admin
    ? [['#/admin', 'Dashboard', 'admin', 'home'], ['#/inventory', 'Inventory', 'inventory', 'box'], ['#/borrowing', 'Borrowing Requests', 'borrowing', 'clipboard'], ['#/returns', 'Returns', 'returns', 'back', waitingReturns], ['#/transactions', 'Transactions & Reports', 'transactions', 'list']]
    : [['#/student', 'Dashboard', 'student', 'home'], ['#/inventory', 'Browse Equipment', 'inventory', 'box'], ['#/borrowing', 'My Requests', 'borrowing', 'clipboard'], ['#/transactions', 'My History', 'transactions', 'list']];
  $('#sidebar').innerHTML =
    $('#tpl-brand').innerHTML +      // the logo is in index.html (tpl-brand)
    '<nav class="nav">' + links.map((l) => '<a href="' + l[0] + '"' + (l[2] === page ? ' class="active" aria-current="page"' : '') + '>' + icon(l[3]) + '<span class="nav-label">' + l[1] + '</span>' + (l[4] ? '<span class="nav-count">' + l[4] + '</span>' : '') + '</a>').join('') + '</nav>' +
    '<div class="side-foot"><div class="who"><span class="avatar">' + esc(firstNameOf(user.name).charAt(0).toUpperCase()) + '</span><div><b>' + esc(user.name) + '</b><span>' + (admin ? 'Admin / Sports Custodian' : 'Student · ' + esc(user.studentId)) + '</span></div></div><button class="btn btn-sm" id="logoutBtn" type="button">' + icon('logout') + 'Log out</button></div>';
  $('#topbar').innerHTML =
    '<button class="menu-btn" id="menuBtn" type="button" aria-label="Open menu"><span></span><span></span><span></span></button>' +
    '<h1>' + esc(document.body.dataset.title) + '</h1><span class="today">' + fmtDate(todayStr()) + '</span><span class="role-chip">' + (admin ? 'Admin' : 'Student') + '</span>';
  $('#logoutBtn').addEventListener('click', () => {
    confirmAction({ title: 'Log out?', confirmLabel: 'Log out', message: 'Do you want to log out of <b>VCI CUSTODIAN</b>?' }, () => { logout(); navigate('login'); });
  });
  $$('.nav a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('nav-open')));   // close the phone menu
  const toggle = () => document.body.classList.toggle('nav-open');
  $('#menuBtn').addEventListener('click', toggle);
  $('#scrim').onclick = toggle;
}
function pageHead(title, sub, actionsHtml) {
  return '<div class="page-head"><div><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div><div class="actions">' + (actionsHtml || '') + '</div></div>';
}

/* ---------------------------------------------------------
   5. PAGE CONTROLLERS
   --------------------------------------------------------- */
const pages = {};

/* ===== Admin password: change, recovery code, forgot password ===== */
function pwField(id, name, label, auto) {
  return '<div class="field"><label for="' + id + '">' + label + '</label><input type="password" id="' + id + '" name="' + name + '" autocomplete="' + (auto || 'new-password') + '"><small class="error" data-for="' + name + '"></small></div>';
}
function changePasswordDialog() {
  openModal({
    title: 'Change Admin password',
    body: '<form id="cpForm" novalidate>' + pwField('cp_c', 'currentPassword', 'Current password', 'current-password') +
      pwField('cp_n', 'newPassword', 'New password (at least ' + MIN_ADMIN_PASSWORD + ' characters)') + pwField('cp_f', 'confirmPassword', 'Confirm new password') + '</form>',
    actions: [{ label: 'Cancel', cls: 'btn-ghost' }, { label: 'Change password', cls: 'btn-primary', onClick: (m) => {
      const form = $('#cpForm', m), res = changeAdminPassword(formData(form));
      if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors).length) toast(res.error, 'error'); return false; }
      toast('Admin password changed.');
    } }]
  });
}
function recoveryCodeDialog() {
  openModal({
    title: 'Generate recovery code',
    body: '<p>A recovery code lets you reset the Admin password if you forget it. Generating a new code <b>replaces the old one</b>.</p><form id="rcForm" novalidate>' + pwField('rc_c', 'currentPassword', 'Enter your current password to continue', 'current-password') + '</form>',
    actions: [{ label: 'Cancel', cls: 'btn-ghost' }, { label: 'Generate code', cls: 'btn-primary', onClick: (m) => {
      const form = $('#rcForm', m), res = generateRecoveryCode(formData(form).currentPassword);
      if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors).length) toast(res.error, 'error'); return false; }
      openModal({
        title: 'Your recovery code',
        body: '<p>Write this code down and keep it somewhere safe. <b>It is shown only once</b> and works only once.</p><p class="note-box" style="font-size:1.2rem;letter-spacing:.06em;text-align:center"><b>' + esc(res.data) + '</b></p><p class="muted small">Only a scrambled version is saved in this browser. Anyone who has this code can reset the Admin password.</p>',
        actions: [{ label: 'I have saved it', cls: 'btn-primary' }]
      });
      return false;
    } }]
  });
}
function studentForgotInfoDialog() {
  openModal({
    title: 'Forgot your student password?',
    body: '<p>Your password cannot be shown, but the <b>Sports Custodian (Admin)</b> can give you a temporary one.</p>' +
      '<ol class="steps"><li>Go to the Sports Custodian and tell them your <b>name and Student ID</b>.</li><li>The custodian resets your password and gives you a temporary password.</li><li>Log in with it. You will be asked to choose your own new password.</li></ol>' +
      '<p class="muted small">Locked out after too many wrong tries? A reset also removes the lock. This system saves accounts in one browser, so the reset must be done on the same computer or phone browser where you registered.</p>',
    actions: [{ label: 'OK', cls: 'btn-primary' }]
  });
}
function changeStudentPasswordDialog(forced) {
  openModal({
    title: forced ? 'Choose a new password' : 'Change my password', locked: !!forced,
    body: (forced ? '<p class="note-box">Your password was reset by the Sports Custodian. Enter the temporary password you were given, then choose a new password.</p>' : '') +
      '<form id="spForm" novalidate>' + pwField('sp_c', 'currentPassword', forced ? 'Temporary password' : 'Current password', 'current-password') +
      pwField('sp_n', 'newPassword', 'New password (at least ' + MIN_PASSWORD + ' characters)') + pwField('sp_f', 'confirmPassword', 'Confirm new password') + '</form>',
    actions: (forced ? [] : [{ label: 'Cancel', cls: 'btn-ghost' }]).concat([{ label: 'Save password', cls: 'btn-primary', onClick: (m) => {
      const form = $('#spForm', m), res = changeStudentPassword(formData(form));
      if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors || {}).length) toast(res.error, 'error'); return false; }
      USER = currentUser(); toast('Password changed.');
    } }])
  });
}
// Admin: list of student accounts with a Reset password button
function wireStudentAccounts(el) {
  const draw = () => {
    const q = ($('#saq', el).value || '').trim().toLowerCase(), all = getStudentAccounts();
    const list = all.filter((a) => !q || [a.name, a.studentId, a.username].join(' ').toLowerCase().includes(q));
    $('#saList', el).innerHTML = list.length
      ? '<div class="table-wrap"><table class="stack"><thead><tr><th>Student</th><th>Student ID</th><th>Username</th><th></th></tr></thead><tbody>' + list.map((a) =>
        '<tr><td data-label="Student"><b>' + esc(a.name) + '</b><span class="sub">' + esc(a.course) + ' ' + esc(a.yearLevel) + '</span></td><td data-label="Student ID">' + esc(a.studentId) + '</td><td data-label="Username">' + esc(a.username) + (a.mustChangePassword ? '<span class="sub late">Temporary password not changed yet</span>' : '') + '</td>' +
        '<td class="acts"><button class="btn btn-sm" data-resetpw="' + esc(a.id) + '" type="button">Reset password</button></td></tr>').join('') + '</tbody></table></div>'
      : '<p class="empty">' + (all.length ? 'No student matches your search.' : 'No student has registered yet.') + '</p>';
  };
  draw();
  $('#saq', el).addEventListener('input', draw);
  $('#saList', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-resetpw]'); if (!b) return;
    const acc = getAccounts().find((a) => a.id === b.dataset.resetpw); if (!acc) return;
    confirmAction({ title: 'Reset password?', confirmLabel: 'Reset password', message: 'Create a temporary password for <b>' + esc(acc.name) + '</b> (' + esc(acc.studentId) + ')? Their old password will stop working. Only do this after you have checked who the student is.' }, () => {
      const res = resetStudentPassword(acc.id);
      if (!res.ok) { toast(res.error, 'error'); return; }
      setTimeout(() => { openModal({
        title: 'Temporary password',
        body: '<p>Give this temporary password to <b>' + esc(acc.name) + '</b>. <b>It is shown only once.</b> The student must choose a new password at the next login.</p><p class="note-box" style="font-size:1.4rem;letter-spacing:.08em;text-align:center"><b>' + esc(res.data.password) + '</b></p>',
        actions: [{ label: 'I have given it to the student', cls: 'btn-primary' }]
      }); draw(); }, 0);
    });
  });
}
function adminSetupDialog(onDone) {
  openModal({
    title: 'Set up the Admin account',
    body: '<p>No Administrator account exists yet. The username will be <b>admin</b>. Choose the name and a password; the password is not stored anywhere in the code.</p><form id="asForm" novalidate>' +
      '<div class="field"><label for="as_n">Administrator full name</label><input type="text" id="as_n" name="name" autocomplete="name"><small class="error" data-for="name"></small></div>' +
      pwField('as_p', 'newPassword', 'Password (at least ' + MIN_ADMIN_PASSWORD + ' characters)') + pwField('as_c', 'confirmPassword', 'Confirm password') + '</form>',
    actions: [{ label: 'Cancel', cls: 'btn-ghost' }, { label: 'Create Admin account', cls: 'btn-primary', onClick: (m) => {
      const form = $('#asForm', m), res = createInitialAdmin(formData(form));
      if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors || {}).length) toast(res.error, 'error'); return false; }
      toast('Admin account created. Log in with the username admin.'); onDone();
    } }]
  });
}
function forgotPasswordDialog() {
  openModal({
    title: 'Reset the Admin password',
    body: '<p>Enter the recovery code that was generated from the Admin dashboard (Admin security), then choose a new password.</p><form id="fpForm" novalidate>' +
      '<div class="field"><label for="fp_c">Recovery code</label><input type="text" id="fp_c" name="code" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX"><small class="error" data-for="code"></small></div>' +
      pwField('fp_n', 'newPassword', 'New password (at least ' + MIN_ADMIN_PASSWORD + ' characters)') + pwField('fp_f', 'confirmPassword', 'Confirm new password') +
      '</form><p class="muted small">No recovery code? Student accounts cannot reset the Admin password. The school IT staff can clear this browser\'s saved data, which removes all records and lets you set up a new Admin account.</p>',
    actions: [{ label: 'Cancel', cls: 'btn-ghost' }, { label: 'Reset password', cls: 'btn-primary', onClick: (m) => {
      const form = $('#fpForm', m), res = resetPasswordWithRecoveryCode(formData(form));
      if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors).length) toast(res.error, 'error'); return false; }
      toast('Password reset. Log in with your new password.');
    } }]
  });
}

/* ===== Login ===== */
pages.login = function () {
  mount('tpl-login');
  const form = $('#loginForm'), alertBox = $('#formAlert');
  wirePasswordToggles($('#auth'));
  const forgot = $('#forgotLink');
  const refreshSetup = () => {
    forgot.textContent = hasAdminAccount() ? 'Forgot password?' : 'Set up the Admin account';
    if (hasAdminAccount()) alertBox.hidden = true;
  };
  forgot.addEventListener('click', (e) => {            // one clean link; the dialog asks who forgot the password
    e.preventDefault();
    if (!hasAdminAccount()) { adminSetupDialog(refreshSetup); return; }
    openModal({
      title: 'Forgot password?', body: '<p>Who forgot the password?</p>',
      actions: [{ label: 'Cancel', cls: 'btn-ghost' },
        { label: 'I am the Admin', onClick: () => { setTimeout(forgotPasswordDialog, 0); } },
        { label: 'I am a student', cls: 'btn-primary', onClick: () => { setTimeout(studentForgotInfoDialog, 0); } }]
    });
  });
  refreshSetup();
  if (!hasAdminAccount()) { alertBox.textContent = 'No Administrator account exists yet. Use “Set up the Admin account” below.'; alertBox.hidden = false; }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    const d = formData(form), errors = {};
    if (!d.username.trim()) errors.username = 'Enter your username.';
    if (!d.password) errors.password = 'Enter your password.';
    setErrors(form, errors);
    if (Object.keys(errors).length) return;
    const res = login(d.username, d.password);
    if (!res.ok) { alertBox.textContent = res.error; alertBox.hidden = false; return; }
    navigate(homeFor(res.data));
  });
};

/* ===== Student registration ===== */
pages.register = function () {
  mount('tpl-register');
  const form = $('#registerForm'), alertBox = $('#formAlert'), review = $('#reviewBox');
  wirePasswordToggles($('#auth'));
  const rows = [['Role', () => 'Student'], ['Student ID', (d) => d.studentId], ['Complete name', (d) => d.name], ['Course', (d) => d.course],
    ['Year level', (d) => d.yearLevel], ['Username', (d) => d.username], ['Password', (d) => (d.password ? '•'.repeat(Math.min(d.password.length, 12)) + ' (' + d.password.length + ' characters)' : '')],
    ['Passwords match?', (d) => (d.confirmPassword ? (d.password === d.confirmPassword ? 'Yes' : 'No — they differ') : '')]];
  const updateReview = () => {
    const d = formData(form);
    review.innerHTML = rows.map((r) => { const v = String(r[1](d) || '').trim(); return '<dt>' + r[0] + '</dt><dd class="' + (v ? '' : 'empty') + '">' + (v ? esc(v) : 'Not entered yet') + '</dd>'; }).join('');
  };
  form.addEventListener('input', updateReview); updateReview();
  form.addEventListener('submit', (e) => {
    e.preventDefault(); alertBox.hidden = true;
    const res = registerStudent(formData(form));
    if (!res.ok) { setErrors(form, res.errors); alertBox.textContent = res.error; alertBox.hidden = false; return; }
    setErrors(form, {});
    login(res.data.username, formData(form).password);          // log the new student in automatically
    form.hidden = true;
    const okBox = $('#successBox');
    okBox.innerHTML = '<b>Account created successfully.</b> Welcome, ' + esc(res.data.name) + '! Taking you to your dashboard… <a href="#/student">Go now</a>';
    okBox.hidden = false;
    setTimeout(() => { navigate('student'); }, 1800);
  });
};

/* ===== Admin dashboard ===== */
pages.admin = function (el) {
  const eqs = getEquipment(), reqs = getBorrowingRequests(), txns = getTransactions();
  const total = eqs.reduce((s, e) => s + e.totalQty, 0);
  const avail = eqs.reduce((s, e) => s + borrowableQty(e), 0);
  const borrowed = eqs.reduce((s, e) => s + e.borrowedQty, 0);
  const outOfService = Math.max(0, total - avail - borrowed);     // damaged, under repair or unavailable units
  const pending = reqs.filter((r) => r.status === 'Pending');
  const approved = reqs.filter((r) => r.status === 'Approved');             // approved but not issued yet: stock is still on the shelf
  const overdue = reqs.filter((r) => r.status === 'Overdue');
  // Active borrowing = issued and not fully returned. This is the same list the Returns page and the Borrowed report use.
  const active = reqs.filter((r) => ['Borrowed', 'Overdue'].includes(r.status)).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const activeUnits = active.reduce((s, r) => s + outstandingQty(r), 0);
  const waitingReturns = pendingReturns().length;                  // student returns waiting for the admin to verify
  const alerts = eqs.filter((e) => stockLabel(e) !== 'Available');
  const recentReq = reqs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const recentTx = txns.slice().sort((a, b) => b.datetime.localeCompare(a.datetime)).slice(0, 5);
  const li = (main, meta, right) => '<li><div>' + main + '<div class="meta">' + meta + '</div></div><div>' + right + '</div></li>';
  el.innerHTML = pageHead('Welcome, ' + USER.name, 'Overview of sports equipment and borrowing activity.') +
    '<div class="stats">' +
    statCard('', 'box', total, 'Total Equipment', 'physical items · ' + eqs.length + ' equipment record(s)', '#/inventory') +
    statCard('good', 'check', avail, 'Available Equipment', 'Ready to borrow · ' + outOfService + ' out of service', '#/inventory') +
    statCard(overdue.length ? 'bad' : '', 'user', borrowed, 'Borrowed Equipment', 'units out · ' + active.length + ' active transaction(s) · ' + overdue.length + ' overdue', '#/borrowing') +
    statCard(waitingReturns ? 'warn' : '', 'back', waitingReturns, 'Pending Returns', 'Waiting for your verification', '#/returns') + '</div>' +
    // Borrowing requests that still need a decision (only shown when there are some)
    (pending.length ? '<div class="notice">' + icon('inbox') + '<span><b>' + pending.length + ' borrowing request(s)</b> waiting for your review.</span><a class="btn btn-sm btn-primary" href="#/borrowing?status=Pending">Review now</a></div>' : '') +
    (approved.length ? '<div class="notice">' + icon('clipboard') + '<span><b>' + approved.length + ' approved request(s)</b> not issued yet. Equipment counts as borrowed only after you click <b>Issue</b>.</span><a class="btn btn-sm btn-primary" href="#/borrowing?status=Approved">Issue now</a></div>' : '') +
    '<div class="quick"><a href="#/inventory">' + icon('box') + '<div><b>Inventory</b><span>Add or edit equipment</span></div></a><a href="#/borrowing">' + icon('clipboard') + '<div><b>Borrowing</b><span>Approve and issue</span></div></a><a href="#/returns">' + icon('back') + '<div><b>Returns</b><span>Record returned items</span></div></a><a href="#/transactions?tab=reports">' + icon('report') + '<div><b>Reports</b><span>View reports</span></div></a></div>' +
    '<div class="card"><div class="card-head"><h3>Currently borrowed equipment</h3><span class="muted small">' + active.length + ' active transaction(s) · ' + activeUnits + ' unit(s) out</span></div>' +
    (active.length ? '<div class="table-wrap"><table class="stack"><thead><tr><th>Equipment</th><th>Borrower</th><th>Qty out</th><th>Borrowed on</th><th>Expected return</th><th>Status</th><th></th></tr></thead><tbody>' +
      active.map((r) => '<tr class="' + (r.status === 'Overdue' ? 'row-overdue' : '') + '"><td data-label="Equipment"><b>' + esc(r.equipmentName) + '</b><span class="sub">' + esc(r.id) + '</span></td>' +
        '<td data-label="Borrower">' + esc(r.studentName) + '<span class="sub">' + esc(r.studentId) + '</span></td>' +
        '<td data-label="Qty out">' + outstandingQty(r) + (outstandingQty(r) !== r.quantity ? ' of ' + r.quantity : '') + '</td>' +
        '<td data-label="Borrowed on">' + fmtDate(r.issueDate) + '</td>' +
        '<td data-label="Expected return">' + fmtDate(r.dueDate) + (r.status === 'Overdue' ? '<span class="sub late">' + daysBetween(r.dueDate, todayStr()) + ' day(s) late</span>' : '') + '</td>' +
        '<td data-label="Status">' + badge(r.status) + (pendingReturnFor(r.id) ? ' ' + badge('Pending Verification') : '') + '</td>' +
        '<td class="acts"><button class="btn btn-sm" data-detail="' + esc(r.id) + '" type="button">Details</button></td></tr>').join('') + '</tbody></table></div>'
      : '<p class="empty">Nothing is borrowed right now. Equipment appears here after you approve a request and click <b>Issue</b>.</p>') + '</div>' +
    '<div class="grid2"><div class="card"><div class="card-head"><h3>Overdue equipment</h3><a href="#/borrowing">View all</a></div>' +
    (overdue.length ? '<ul class="list">' + overdue.map((r) => li('<b>' + esc(r.equipmentName) + '</b> × ' + outstandingQty(r), esc(r.studentName) + ' (' + esc(r.studentId) + ') · due ' + fmtDate(r.dueDate), '<span class="badge b-overdue">' + daysBetween(r.dueDate, todayStr()) + ' day(s) late</span>')).join('') + '</ul>' : '<p class="empty">No overdue equipment.</p>') + '</div>' +
    '<div class="card"><div class="card-head"><h3>Low-stock and unavailable alerts</h3><a href="#/inventory">Inventory</a></div>' +
    (alerts.length ? '<ul class="list">' + alerts.slice(0, 8).map((e) => li('<b>' + esc(e.name) + '</b>', e.availableQty + ' available of ' + e.totalQty, badge(stockLabel(e)))).join('') + '</ul>' : '<p class="empty">All equipment is in stock.</p>') + '</div></div>' +
    '<div class="grid2"><div class="card"><div class="card-head"><h3>Recent borrowing requests</h3><a href="#/borrowing">View all</a></div>' +
    (recentReq.length ? '<ul class="list">' + recentReq.map((r) => li('<b>' + esc(r.equipmentName) + '</b> × ' + r.quantity, esc(r.studentName) + ' · ' + esc(r.id) + ' · ' + fmtDate(r.createdAt.slice(0, 10)), badge(r.status))).join('') + '</ul>' : '<p class="empty">No requests yet.</p>') + '</div>' +
    '<div class="card"><div class="card-head"><h3>Recent transactions</h3><a href="#/transactions">View all</a></div>' +
    (recentTx.length ? '<ul class="list">' + recentTx.map((t) => li('<b>' + esc(t.action) + '</b>', esc(t.equipmentName) + ' × ' + t.quantity + ' · ' + esc(t.studentName), '<span class="meta">' + fmtDateTime(t.datetime) + '</span>')).join('') + '</ul>' : '<p class="empty">No transactions yet.</p>') + '</div></div>' +
    '<div class="card"><div class="card-head"><h3>Student accounts</h3><span class="muted small">Forgot password? Reset it here.</span></div><div class="toolbar"><div class="field grow"><label for="saq">Search student</label><input type="search" id="saq" placeholder="Name, Student ID or username"></div></div><div id="saList"></div></div>' +
    '<div class="card"><h3>Admin security</h3><p class="muted">Change the Admin password, or create a one-time recovery code so a forgotten password can be reset.</p><button class="btn" id="pwBtn" type="button">Change password</button> <button class="btn" id="rcBtn" type="button">Generate recovery code</button></div>' +
    '<div class="card"><h3>Demo data</h3><p class="muted">Data is stored in this browser only. Resetting deletes all student accounts, requests and transactions saved here and restores the sample equipment.</p><button class="btn btn-danger" id="resetBtn" type="button">Reset Demo Data</button></div>';
  el.addEventListener('click', (e) => {                                // "Details" in the borrowed-equipment table
    const b = e.target.closest('[data-detail]'); if (!b) return;
    const r = getRequestById(b.dataset.detail); if (r) requestDetails(r);
  });
  wireStudentAccounts(el);
  $('#pwBtn').addEventListener('click', changePasswordDialog);
  $('#rcBtn').addEventListener('click', recoveryCodeDialog);
  $('#resetBtn').addEventListener('click', () => {
    confirmAction({
      title: 'Reset demo data?', danger: true, confirmLabel: 'Yes, delete and reset',
      message: '<b>This permanently deletes all locally stored demo records</b> — student accounts, requests, returns and transactions — and restores the initial sample equipment. The Admin account is kept. Students will need to register again. This cannot be undone.'
    }, () => { resetDemoData(); toast('Demo data was reset.'); pages.admin(el); });
  });
};

/* ===== Student dashboard ===== */
pages.student = function (el) {
  const mine = getRequestsForStudent(USER.studentId);
  const avail = getEquipment().reduce((s, e) => s + borrowableQty(e), 0);
  const count = (st) => mine.filter((r) => r.status === st).length;
  const active = mine.filter((r) => ['Borrowed', 'Overdue'].includes(r.status)).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const borrowedNow = active.reduce((s, r) => s + outstandingQty(r), 0);
  const recent = mine.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const quickEq = getEquipment().filter((e) => borrowableQty(e) > 0).slice(0, 4);     // a few items that can be requested right now
  // Friendly text about a due date, worked out from today's date
  const dueText = (r) => {
    const d = daysBetween(todayStr(), r.dueDate);
    if (d < 0) return '<span class="badge b-overdue">' + (-d) + ' day(s) late</span>';
    if (d === 0) return '<span class="badge b-pending">Due today</span>';
    return '<span class="badge b-borrowed">' + d + ' day(s) left</span>';
  };
  el.innerHTML = '<section class="welcome"><div><h2>Hello, ' + esc(firstNameOf(USER.name)) + '!</h2><p>' + esc(USER.course) + ' · ' + esc(USER.yearLevel) + ' · ' + esc(USER.studentId) + '</p>' +
    '<p class="welcome-note">' + (count('Overdue') ? 'You have overdue equipment. Please return it as soon as you can.' : borrowedNow ? 'Here is what you are borrowing and when it is due.' : 'Ready to play? Pick some equipment and send a request.') + '</p></div>' +
    '<div class="actions"><a class="btn btn-light" href="#/inventory">Browse equipment</a><a class="btn btn-outline-light" href="#/transactions">View borrowing history</a></div></section>' +
    '<div class="stats">' +
    statCard('good', 'check', avail, 'Available Equipment', 'Units you can request', '#/inventory') +
    statCard(count('Pending') ? 'warn' : '', 'inbox', count('Pending'), 'Pending Requests', 'Waiting for approval', '#/borrowing') +
    statCard('', 'user', borrowedNow, 'Currently Borrowed', 'Units with you now', '#/borrowing') +
    statCard(count('Overdue') ? 'bad' : '', 'alert', count('Overdue'), 'Overdue', 'Return as soon as possible', '#/borrowing') + '</div>' +
    '<div class="grid2"><div class="card"><div class="card-head"><h3>My borrowed items and due dates</h3><a href="#/borrowing">My requests</a></div>' +
    (active.length ? '<ul class="list">' + active.map((r) => '<li><div><b>' + esc(r.equipmentName) + '</b> × ' + outstandingQty(r) + '<div class="meta">Due ' + fmtDate(r.dueDate) + ' · ' + esc(r.id) + '</div></div><div>' + dueText(r) + '</div></li>').join('') + '</ul>' : '<p class="empty">You are not borrowing anything right now.</p>') + '</div>' +
    '<div class="card"><div class="card-head"><h3>Recent borrowing activity</h3><a href="#/borrowing">View all</a></div>' +
    (recent.length ? '<ul class="list">' + recent.map((r) => '<li><div><b>' + esc(r.equipmentName) + '</b> × ' + r.quantity + '<div class="meta">' + esc(r.id) + ' · ' + fmtDate(r.borrowDate) + ' to ' + fmtDate(r.dueDate || r.returnDate) + '</div></div><div>' + badge(r.status) + '</div></li>').join('') + '</ul>' : '<p class="empty">You have no borrowing activity yet. <a href="#/inventory">Browse equipment</a> to make your first request.</p>') + '</div></div>' +
    '<div class="card"><div class="card-head"><h3>Available equipment</h3><a href="#/inventory">Browse all</a></div>' +
    (quickEq.length ? '<div class="eq-grid" id="quickEq">' + quickEq.map((e) =>
      '<article class="eq-card">' + '<div class="eq-img" data-imgbox>' + imgTag(e.image, '', e.name) + '</div>' + '<div class="eq-body"><div class="eq-meta"><span>' + esc(e.category) + '</span>' + badge(stockLabel(e)) + '</div><h3>' + esc(e.name) + '</h3>' +
      '<div class="stock-line"><span><b>' + borrowableQty(e) + '</b> available of ' + e.totalQty + '</span></div>' + stockMeter(e) +
      '<div class="eq-actions"><button class="btn btn-sm btn-primary" data-req="' + e.id + '" type="button">Request</button></div></div></article>').join('') + '</div>' : '<p class="empty">No equipment is available right now. Please check again later.</p>') + '</div>' +
    '<div class="card"><h3>My account</h3><p class="muted">Change your password any time. If you forget it, ask the Sports Custodian to reset it.</p><button class="btn" id="stuPwBtn" type="button">Change password</button></div>';
  $('#stuPwBtn').addEventListener('click', () => changeStudentPasswordDialog(false));
  const quick = $('#quickEq');
  if (quick) quick.addEventListener('click', (e) => {
    const b = e.target.closest('[data-req]'); if (!b) return;
    borrowRequestFlow(b.dataset.req, () => pages.student(el));          // redraw this page after a request is sent
  });
};

/* ===== Inventory (admin manages, students browse and request) ===== */
pages.inventory = function (el) {
  const admin = USER.role === 'admin';
  const f = { q: '', cat: '', avail: '' };
  el.innerHTML = pageHead(admin ? 'Equipment Inventory' : 'Browse Equipment', admin ? 'Manage sports equipment, stock and condition.' : 'Find equipment and send a borrowing request.',
    admin ? '<button class="btn btn-primary" id="addBtn" type="button">Add equipment</button>' : '') +
    '<div class="toolbar"><div class="field grow"><label for="fq">Search by name</label><input type="search" id="fq" placeholder="Search equipment…"></div>' +
    '<div class="field"><label for="fav">Availability</label><select id="fav"><option value="">All</option><option value="available">Available now</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="unavailable">Unavailable</option><option value="damaged">Damaged</option><option value="repair">Under repair</option></select></div></div>' +
    '<div class="chips" id="catChips" aria-label="Filter by category"></div>' +
    '<div id="grid" class="eq-grid"></div>';
  const fillCats = () => {                       // only categories that have equipment; the selected one turns green
    const all = getEquipment(), counts = {};
    all.forEach((e) => { counts[e.category] = (counts[e.category] || 0) + 1; });
    if (f.cat && !counts[f.cat]) f.cat = '';
    $('#catChips').innerHTML = '<button type="button" class="chip' + (f.cat ? '' : ' on') + '" data-cat="">All<b>' + all.length + '</b></button>' +
      allCategories().filter((c) => counts[c]).map((c) => '<button type="button" class="chip' + (c === f.cat ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '<b>' + counts[c] + '</b></button>').join('');
  };
  const matches = (e) => {
    if (f.q && !(e.name + ' ' + e.category).toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.cat && e.category !== f.cat) return false;
    const label = stockLabel(e);
    return !f.avail || ({ available: borrowableQty(e) > 0, low: label === 'Low Stock', out: label === 'Out of Stock', unavailable: e.status === 'Unavailable', damaged: e.status === 'Damaged', repair: e.status === 'Under Repair' }[f.avail]);
  };
  const render = () => {
    const list = getEquipment().filter(matches);
    $('#grid').innerHTML = list.length ? list.map((e) =>
      '<article class="eq-card">' + '<div class="eq-img" data-imgbox data-view="' + e.id + '">' + imgTag(e.image, '', e.name) + '</div>' + '<div class="eq-body">' +
      '<div class="eq-meta"><span>' + esc(e.category) + ' · <span class="nowrap">' + esc(e.id) + '</span></span>' + badge(stockLabel(e)) + '</div><h3>' + esc(e.name) + '</h3>' +
      (admin
        ? '<div class="stock-line"><span>Total <b>' + e.totalQty + '</b></span><span>Available <b>' + e.availableQty + '</b></span><span>Borrowed <b>' + e.borrowedQty + '</b></span>' + (e.unusableQty ? '<span>Damaged/repair <b>' + e.unusableQty + '</b></span>' : '') + '</div>' + stockMeter(e) + '<div class="eq-meta"><span>Condition: ' + esc(e.condition) + '</span></div>' +
          '<div class="eq-actions"><button class="btn btn-sm" data-view="' + e.id + '" type="button">Details</button><button class="btn btn-sm" data-edit="' + e.id + '" type="button">Edit</button><button class="btn btn-sm btn-danger" data-del="' + e.id + '" type="button">Delete</button></div>'
        : '<div class="stock-line"><span><b>' + borrowableQty(e) + '</b> available of ' + e.totalQty + '</span></div>' + stockMeter(e) +
          '<div class="eq-actions"><button class="btn btn-sm" data-view="' + e.id + '" type="button">Details</button><button class="btn btn-sm btn-primary" data-req="' + e.id + '" type="button"' + (borrowableQty(e) > 0 ? '' : ' disabled') + '>Request</button></div>') +
      '</div></article>').join('') : '<p class="empty" style="grid-column:1/-1">No equipment matches your search.</p>';
  };
  fillCats(); render();
  $('#fq').addEventListener('input', (e) => { f.q = e.target.value.trim(); render(); });
  $('#catChips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; f.cat = c.dataset.cat; fillCats(); render(); });
  $('#fav').addEventListener('change', (e) => { f.avail = e.target.value; render(); });
  $('#grid').addEventListener('click', (e) => {
    const t = e.target.closest('[data-view],[data-edit],[data-del],[data-req]'); if (!t) return;
    if (t.dataset.view) showEquipmentDetails(t.dataset.view, admin);
    if (t.dataset.edit) equipmentForm(t.dataset.edit, () => { fillCats(); render(); });
    if (t.dataset.req) borrowRequestFlow(t.dataset.req, render);
    if (t.dataset.del) {
      const eq = getEquipmentById(t.dataset.del), can = canDeleteEquipment(eq);
      if (!can.ok) { toast(can.error, 'error'); return; }
      confirmAction({ title: 'Delete equipment?', danger: true, confirmLabel: 'Delete', message: 'Delete <b>' + esc(eq.name) + '</b> (' + esc(eq.id) + ') from the inventory? This cannot be undone.' },
        () => { const r = deleteEquipment(eq.id); toast(r.ok ? 'Equipment deleted.' : r.error, r.ok ? '' : 'error'); fillCats(); render(); });
    }
  });
  if (admin) $('#addBtn').addEventListener('click', () => equipmentForm(null, () => { fillCats(); render(); }));
};

function showEquipmentDetails(id, admin) {
  const e = getEquipmentById(id); if (!e) return;
  let extra = '';
  if (admin) {
    const holders = getBorrowingRequests().filter((r) => r.equipmentId === id && ['Borrowed', 'Overdue'].includes(r.status));
    extra = '<h4>Currently borrowed by</h4>' + (holders.length ? '<ul class="list">' + holders.map((r) => '<li><span>' + esc(r.studentName) + ' (' + esc(r.studentId) + ') × ' + outstandingQty(r) + '</span><span class="meta">due ' + fmtDate(r.dueDate) + '</span></li>').join('') + '</ul>' : '<p class="muted">Nobody at the moment.</p>');
  }
  openModal({
    title: e.name, actions: [{ label: 'Close', cls: 'btn-ghost' }],
    body: '<div class="media-row">' + imgTag(e.image, 'eq-thumb', e.name) + '<div>' + badge(stockLabel(e)) + '<p class="muted small" style="margin:6px 0 0">' + esc(e.id) + ' · ' + esc(e.category) + '</p></div></div>' +
      '<p>' + esc(e.description || 'No description.') + '</p>' +
      kv([['Condition', e.condition], ['Total quantity', e.totalQty], ['Available to borrow', borrowableQty(e)], ['Currently borrowed', e.borrowedQty], ['Damaged / under repair', e.unusableQty], ['Item status', e.status]]) + extra
  });
}

/* ----- Admin: add / edit equipment ----- */
function equipmentForm(id, onSaved) {
  if (!requireAdmin().ok) { toast('Only the administrator can add or edit equipment.', 'error'); return; }
  const eq = id ? getEquipmentById(id) : null;
  let image = eq ? eq.image : '';              // '' = no picture (pictures are optional)
  const v = (k, d) => esc(eq ? eq[k] : d);
  const opts = (arr, cur) => arr.map((o) => '<option' + (o === cur ? ' selected' : '') + '>' + o + '</option>').join('');
  const curCat = eq ? eq.category : '';
  openModal({
    title: eq ? 'Edit equipment ' + eq.id : 'Add equipment', wide: true,
    body: '<form id="eqForm" novalidate>' +
      '<div class="field"><label for="ef_name">Equipment name</label><input type="text" id="ef_name" name="name" value="' + v('name', '') + '"><small class="error" data-for="name"></small></div>' +
      '<div class="field"><label id="ef_catlabel">Category</label><div class="chips" id="ef_cats" role="group" aria-labelledby="ef_catlabel">' +
        allCategories().map((c) => '<button type="button" class="chip' + (c === curCat ? ' on' : '') + '" data-cat="' + esc(c) + '" aria-pressed="' + (c === curCat) + '">' + esc(c) + '</button>').join('') +
        '<button type="button" class="chip" data-cat="__custom" aria-pressed="false">+ Custom category</button></div>' +
        '<input type="text" id="ef_custom" maxlength="40" placeholder="Type the sport or equipment category" hidden>' +
        '<input type="hidden" id="ef_cat" name="category" value="' + esc(curCat) + '"><small class="error" data-for="category"></small></div>' +
      '<div class="field"><label for="ef_cond">Condition</label><select id="ef_cond" name="condition">' + opts(EQUIP_CONDITIONS, eq ? eq.condition : 'Good') + '</select><small class="error" data-for="condition"></small></div>' +
      '<div class="field"><label for="ef_desc">Description</label><textarea id="ef_desc" name="description">' + v('description', '') + '</textarea><small class="error" data-for="description"></small></div>' +
      '<div class="row2"><div class="field"><label for="ef_total">Total quantity</label><input type="number" min="1" id="ef_total" name="totalQty" value="' + v('totalQty', 1) + '"><small class="error" data-for="totalQty"></small></div>' +
      '<div class="field"><label for="ef_unus">Damaged / under repair units</label><input type="number" min="0" id="ef_unus" name="unusableQty" value="' + v('unusableQty', 0) + '"><small class="error" data-for="unusableQty"></small></div></div>' +
      (eq ? '<p class="muted small">Currently borrowed: ' + eq.borrowedQty + ' unit(s). Total quantity cannot go below the borrowed units. Available stock is calculated automatically.</p>' : '') +
      '<div class="field"><label for="ef_status">Status</label><select id="ef_status" name="status">' + opts(EQUIP_STATUSES, eq ? eq.status : 'Available') + '</select><small class="error" data-for="status"></small><small class="muted">Damaged, Under Repair and Unavailable items cannot be borrowed.</small></div>' +
      '<div class="field"><label for="ef_preset">Image <span class="muted small">(optional)</span></label><div class="media-row"><img id="ef_prev" class="preview-img" alt="Preview" hidden><div style="flex:1">' +
        '<select id="ef_preset"><option value="">No image</option>' + presetImages().map((p) => '<option value="' + esc(p.path) + '">' + esc(p.label) + '</option>').join('') + '<option value="custom">Custom (uploaded)</option></select>' +
        '<input type="file" id="ef_file" accept="image/*" style="margin-top:8px"><small class="muted">You can save equipment without an image. Pick a picture from the list or upload one (it is resized to save space).</small><small class="error" data-for="image"></small></div></div></div></form>',
    actions: [
      { label: 'Cancel', cls: 'btn-ghost' },
      { label: eq ? 'Save changes' : 'Add equipment', cls: 'btn-primary', onClick: (m) => {
        const form = $('#eqForm', m); const d = formData(form); d.image = image;
        const res = eq ? updateEquipment(eq.id, d) : addEquipment(d);
        if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors || {}).length) toast(res.error, 'error'); return false; }
        toast(eq ? 'Equipment updated.' : 'Equipment added.'); onSaved();
      } }
    ],
    onOpen: (m) => {
      // --- category: pick a suggested one (turns green) or type a custom one ---
      const chips = $('#ef_cats', m), hidden = $('#ef_cat', m), custom = $('#ef_custom', m);
      const mark = (btn) => { $$('.chip', chips).forEach((c) => { c.classList.toggle('on', c === btn); c.setAttribute('aria-pressed', c === btn); }); };
      chips.addEventListener('click', (ev) => {
        const c = ev.target.closest('.chip'); if (!c) return;
        mark(c);
        if (c.dataset.cat === '__custom') { custom.hidden = false; hidden.value = custom.value; custom.focus(); }
        else { custom.hidden = true; hidden.value = c.dataset.cat; }
      });
      custom.addEventListener('input', () => { hidden.value = custom.value; });
      // --- image: optional ---
      const prev = $('#ef_prev', m), preset = $('#ef_preset', m);
      const setImg = (src) => {
        image = src;
        if (!src) { prev.hidden = true; prev.removeAttribute('src'); return; }
        prev.hidden = false;
        prev.onerror = () => { prev.onerror = null; prev.hidden = true; };
        prev.src = src;
      };
      setImg(image);
      if (!image) preset.value = '';
      else if (presetImages().some((p) => p.path === image)) preset.value = image;
      else preset.value = 'custom';
      preset.addEventListener('change', () => { if (preset.value !== 'custom') setImg(preset.value); });
      $('#ef_file', m).addEventListener('change', (ev) => {
        const file = ev.target.files[0], err = $('[data-for="image"]', m); err.textContent = '';
        if (!file) return;
        if (!/^image\//.test(file.type)) { err.textContent = 'Please choose an image file.'; return; }
        if (file.size > 3 * 1024 * 1024) { err.textContent = 'Image is too large (3 MB maximum).'; return; }
        const reader = new FileReader();
        reader.onload = () => {
          const im = new Image();
          im.onload = () => {
            const s = Math.min(1, 400 / Math.max(im.width, im.height));
            const c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
            c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
            setImg(c.toDataURL('image/jpeg', 0.8)); preset.value = 'custom';
          };
          im.onerror = () => { err.textContent = 'That image could not be read.'; };
          im.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }
  });
}

/* ----- Student: borrowing request (form -> review -> submit) ----- */
function borrowRequestFlow(equipmentId, onDone) {
  const eq = getEquipmentById(equipmentId);
  if (!eq) return;
  const today = todayStr();
  const data = { equipmentId, quantity: '1', borrowDate: today, returnDate: addDays(today, 1), purpose: '' };
  const formHtml = () =>
    '<div class="media-row">' + imgTag(eq.image, 'eq-thumb', eq.name) + '<div><b>' + esc(eq.name) + '</b><div class="muted small">' + esc(eq.category) + '</div>' + '<div>' + borrowableQty(eq) + ' available</div></div></div>' +
    '<form id="brForm" novalidate><div class="field"><label for="br_q">Quantity</label><input type="number" id="br_q" name="quantity" min="1" max="' + borrowableQty(eq) + '" value="' + esc(data.quantity) + '"><small class="error" data-for="quantity"></small></div>' +
    '<div class="row2"><div class="field"><label for="br_b">Borrowing date</label><input type="date" id="br_b" name="borrowDate" min="' + today + '" value="' + data.borrowDate + '"><small class="error" data-for="borrowDate"></small></div>' +
    '<div class="field"><label for="br_r">Expected return date</label><input type="date" id="br_r" name="returnDate" min="' + today + '" value="' + data.returnDate + '"><small class="error" data-for="returnDate"></small></div></div>' +
    '<div class="field"><label for="br_p">Purpose / reason</label><textarea id="br_p" name="purpose" placeholder="e.g. PE class activity, intramurals practice">' + esc(data.purpose) + '</textarea><small class="error" data-for="purpose"></small></div></form>';
  const showForm = () => openModal({
    title: 'Borrow request', body: formHtml(),
    actions: [{ label: 'Cancel', cls: 'btn-ghost' }, { label: 'Review request', cls: 'btn-primary', keepOpen: true, onClick: (m) => {
      const form = $('#brForm', m); Object.assign(data, formData(form));
      const errors = validateBorrowRequest(data, getEquipmentById(equipmentId));
      if (Object.keys(errors).length) { setErrors(form, errors); if (errors.general) toast(errors.general, 'error'); return false; }
      showReview();
    } }]
  });
  let sending = false;                       // blocks a second click while the first one is being saved
  const showReview = () => openModal({
    title: 'Review your request',
    body: '<p class="muted">Please check the details. Your request will be reviewed by the custodian. Stock is only reserved when the equipment is actually issued to you.</p>' +
      kv([['Equipment', eq.name], ['Quantity', data.quantity], ['Borrowing date', fmtDate(data.borrowDate)], ['Expected return', fmtDate(data.returnDate)], ['Purpose', data.purpose.trim()], ['Borrower', USER.name + ' (' + USER.studentId + ')']]),
    actions: [{ label: 'Back', cls: 'btn-ghost', keepOpen: true, onClick: () => { showForm(); } }, { label: 'Submit request', cls: 'btn-primary', onClick: () => {
      if (sending) return;
      sending = true;
      const res = submitBorrowingRequest(USER, data);
      if (!res.ok) { sending = false; toast(res.error, 'error'); return; }
      toast('Request ' + res.data.id + ' submitted. Wait for the custodian to approve it.'); onDone();
    } }]
  });
  showForm();
}

/* ===== Borrowing requests (admin manages, students see their own) ===== */
function requestDetails(r) {
  const tx = getTransactions().filter((t) => t.requestId === r.id).sort((a, b) => a.datetime.localeCompare(b.datetime));
  openModal({
    title: 'Request ' + r.id, wide: true, actions: [{ label: 'Close', cls: 'btn-ghost' }],
    body: kv([['Status', badge(r.status), true], ['Student', r.studentName + ' (' + r.studentId + ')'], ['Course', r.course], ['Equipment', r.equipmentName + ' (' + r.equipmentId + ')'], ['Quantity', r.quantity],
      ['Requested dates', fmtDate(r.borrowDate) + ' to ' + fmtDate(r.returnDate)], ['Purpose', r.purpose], ['Date submitted', fmtDateTime(r.createdAt)],
      ['Issued on', r.issueDate ? fmtDate(r.issueDate) : ''], ['Due date', r.dueDate ? fmtDate(r.dueDate) : ''], ['Returned so far', r.issueDate ? r.returnedQty + ' of ' + r.quantity : ''],
      ['Return status', pendingReturnFor(r.id) ? 'Return submitted ' + fmtDateTime(pendingReturnFor(r.id).submittedAt) + ' — waiting for the administrator to verify' : ''], ['Fully returned on', r.returnedAt ? (r.returnedAtTime ? fmtDateTime(r.returnedAtTime) : fmtDate(r.returnedAt)) : ''], ['Rejection reason', r.rejectReason]]) +
      '<h4>History</h4><ul class="timeline">' + (tx.length ? tx.map((t) => '<li><b>' + esc(t.action) + '</b><span class="meta">' + fmtDateTime(t.datetime) + (t.notes ? ' · ' + esc(t.notes) : '') + '</span></li>').join('') : '<li>No history.</li>') + '</ul>'
  });
}
function rejectDialog(r, onDone) {
  openModal({
    title: 'Reject request ' + r.id,
    body: '<p>Reject <b>' + esc(r.equipmentName) + ' × ' + r.quantity + '</b> for ' + esc(r.studentName) + '?</p><form id="rjForm" novalidate><div class="field"><label for="rj_r">Reason (the student will see this)</label><textarea id="rj_r" name="reason"></textarea><small class="error" data-for="reason"></small></div></form>',
    actions: [{ label: 'Cancel', cls: 'btn-ghost' }, { label: 'Reject request', cls: 'btn-danger solid', onClick: (m) => {
      const res = rejectRequest(r.id, formData($('#rjForm', m)).reason);
      if (!res.ok) { setErrors($('#rjForm', m), res.errors); if (!Object.keys(res.errors).length) toast(res.error, 'error'); return false; }
      toast('Request rejected.'); onDone();
    } }]
  });
}
function issueDialog(r, onDone) {
  const eq = getEquipmentById(r.equipmentId);
  openModal({
    title: 'Issue equipment — ' + r.id,
    body: '<p>Issue <b>' + esc(r.equipmentName) + ' × ' + r.quantity + '</b> to <b>' + esc(r.studentName) + '</b> (' + esc(r.studentId) + ').</p>' +
      '<p class="muted small">Stock in inventory: ' + (eq ? eq.availableQty : 0) + '. Confirming deducts ' + r.quantity + ' unit(s) from available stock.</p>' +
      '<form id="isForm" novalidate><div class="row2"><div class="field"><label for="is_d">Actual issue date</label><input type="date" id="is_d" name="issueDate" max="' + todayStr() + '" value="' + todayStr() + '"><small class="error" data-for="issueDate"></small></div>' +
      '<div class="field"><label for="is_r">Expected return date</label><input type="date" id="is_r" name="dueDate" value="' + esc(r.returnDate < todayStr() ? todayStr() : r.returnDate) + '"><small class="error" data-for="dueDate"></small></div></div></form>',
    actions: [{ label: 'Cancel', cls: 'btn-ghost' }, { label: 'Confirm issue', cls: 'btn-primary', onClick: (m) => {
      const form = $('#isForm', m), res = issueEquipment(r.id, formData(form));
      if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors).length) toast(res.error, 'error'); return false; }
      toast('Equipment issued. Stock updated.'); onDone();
    } }]
  });
}

/* ----- Student: return equipment ----- */
function studentReturnDialog(r, onDone) {
  const out = outstandingQty(r);
  openModal({
    title: 'Return equipment — ' + r.id,
    body: '<p>Return <b>' + esc(r.equipmentName) + '</b> to the Sports Custodian. You can do this any time you no longer need it, even before ' + esc(fmtDate(r.dueDate)) + '.</p>' +
      '<p class="note-box">The date and time are recorded when you press Confirm. The equipment goes back to available stock only after the administrator checks it.</p>' +
      '<form id="srForm" novalidate><div class="row2"><div class="field"><label for="sr_q">Quantity returning now</label><input type="number" id="sr_q" name="qty" min="1" max="' + out + '" value="' + out + '"><small class="error" data-for="qty"></small></div>' +
      '<div class="field"><label for="sr_c">Condition</label><select id="sr_c" name="condition">' + RETURN_CONDITIONS.map((c) => '<option>' + c + '</option>').join('') + '</select><small class="error" data-for="condition"></small></div></div>' +
      '<div class="field"><label for="sr_n">Notes (required if damaged)</label><textarea id="sr_n" name="notes"></textarea><small class="error" data-for="notes"></small></div></form>',
    actions: [{ label: 'Cancel', cls: 'btn-ghost' }, { label: 'Confirm return', cls: 'btn-primary', onClick: (m) => {
      const form = $('#srForm', m), res = submitReturn(r.id, formData(form));
      if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors).length) toast(res.error, 'error'); return false; }
      toast('Return submitted. The administrator will verify it.'); onDone();
    } }]
  });
}
pages.borrowing = function (el, params) {
  const admin = USER.role === 'admin';
  const statuses = REQUEST_STATUSES.concat(['Cancelled']);
  // A dashboard link can open one status directly, for example #/borrowing?status=Approved
  const f = { q: '', status: params && statuses.includes(params.get('status')) ? params.get('status') : '', from: '', to: '' };
  el.innerHTML = pageHead(admin ? 'Borrowing Requests' : 'My Requests', admin ? 'Review requests, issue equipment and watch for overdue items.' : 'Track the status of your borrowing requests.',
    admin ? '' : '<a class="btn btn-primary" href="#/inventory">New request</a>') +
    '<div class="chips" id="chips"></div>' +
    '<div class="toolbar"><div class="field grow"><label for="bq">Search</label><input type="search" id="bq" placeholder="' + (admin ? 'Student name, Student ID, equipment or request ID' : 'Equipment or request ID') + '"></div>' +
    '<div class="field"><label for="bs">Status</label><select id="bs"><option value="">All statuses</option>' + statuses.map((s) => '<option' + (s === f.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="bf">Submitted from</label><input type="date" id="bf"></div><div class="field"><label for="bt">Submitted to</label><input type="date" id="bt"></div></div>' +
    '<div class="table-wrap"><table class="stack"><thead><tr><th>Request</th>' + (admin ? '<th>Student</th>' : '') + '<th>Equipment</th><th>Dates</th><th>Status</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table></div>';
  const mineAll = () => (admin ? getBorrowingRequests() : getRequestsForStudent(USER.studentId));
  const render = () => {
    const all = mineAll();
    $('#chips').innerHTML = '<button class="chip' + (f.status ? '' : ' on') + '" data-st="">All<b>' + all.length + '</b></button>' +
      statuses.map((s) => '<button class="chip' + (f.status === s ? ' on' : '') + '" data-st="' + s + '">' + s + '<b>' + all.filter((r) => r.status === s).length + '</b></button>').join('');
    const q = f.q.toLowerCase();
    const list = all.filter((r) => {
      if (f.status && r.status !== f.status) return false;
      const day = r.createdAt.slice(0, 10);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return !q || [r.id, r.studentName, r.studentId, r.equipmentName, r.equipmentId].join(' ').toLowerCase().includes(q);
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    $('#rows').innerHTML = list.length ? list.map((r) => {
      const dates = r.issueDate ? 'Issued ' + fmtDate(r.issueDate) + '<span class="sub">Due ' + fmtDate(r.dueDate) + (r.status === 'Overdue' ? ' · ' + daysBetween(r.dueDate, todayStr()) + ' day(s) late' : '') + '</span>' : fmtDate(r.borrowDate) + '<span class="sub">Return by ' + fmtDate(r.returnDate) + '</span>';
      let acts = '<button class="btn btn-sm" data-act="view" data-id="' + r.id + '" type="button">View</button>';
      if (admin) {
        if (r.status === 'Pending') acts += '<button class="btn btn-sm btn-primary" data-act="approve" data-id="' + r.id + '" type="button">Approve</button><button class="btn btn-sm btn-danger" data-act="reject" data-id="' + r.id + '" type="button">Reject</button>';
        if (r.status === 'Approved') acts += '<button class="btn btn-sm btn-primary" data-act="issue" data-id="' + r.id + '" type="button">Issue</button><button class="btn btn-sm btn-danger" data-act="reject" data-id="' + r.id + '" type="button">Reject</button>';
        if (r.status === 'Borrowed' || r.status === 'Overdue') acts += pendingReturnFor(r.id)
          ? '<a class="btn btn-sm btn-primary" href="#/returns?verify=' + encodeURIComponent(r.id) + '">Verify return</a>'
          : '<a class="btn btn-sm btn-primary" href="#/returns?req=' + encodeURIComponent(r.id) + '">Record return</a>';
      } else {
        if (r.status === 'Pending') acts += '<button class="btn btn-sm btn-danger" data-act="cancel" data-id="' + r.id + '" type="button">Cancel</button>';
        if (r.status === 'Borrowed' || r.status === 'Overdue') {
          acts += pendingReturnFor(r.id) ? badge('Pending Verification') : '<button class="btn btn-sm btn-primary" data-act="return" data-id="' + r.id + '" type="button">Return Equipment</button>';
        }
      }
      return '<tr class="' + (r.status === 'Overdue' ? 'row-overdue' : '') + '"><td data-label="Request"><b>' + esc(r.id) + '</b><span class="sub">' + fmtDate(r.createdAt.slice(0, 10)) + '</span></td>' +
        (admin ? '<td data-label="Student">' + esc(r.studentName) + '<span class="sub">' + esc(r.studentId) + '</span></td>' : '') +
        '<td data-label="Equipment">' + esc(r.equipmentName) + ' × ' + r.quantity + '<span class="sub">' + esc(r.equipmentId) + '</span></td><td data-label="Dates">' + dates + '</td><td data-label="Status">' + badge(r.status) + '</td><td class="acts">' + acts + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">No requests found.</td></tr>';
  };
  render();
  $('#bq').addEventListener('input', (e) => { f.q = e.target.value.trim(); render(); });
  $('#bs').addEventListener('change', (e) => { f.status = e.target.value; render(); });
  $('#bf').addEventListener('change', (e) => { f.from = e.target.value; render(); });
  $('#bt').addEventListener('change', (e) => { f.to = e.target.value; render(); });
  $('#chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; f.status = c.dataset.st; $('#bs').value = f.status; render(); });
  $('#rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const r = getRequestById(b.dataset.id); if (!r) return;
    const done = () => render();
    if (b.dataset.act === 'view') requestDetails(r);
    if (b.dataset.act === 'return' && !admin) studentReturnDialog(r, done);
    if (b.dataset.act === 'reject' && admin) rejectDialog(r, done);
    if (b.dataset.act === 'issue' && admin) issueDialog(r, done);
    if (b.dataset.act === 'approve' && admin) confirmAction({ title: 'Approve request?', confirmLabel: 'Approve', message: 'Approve <b>' + esc(r.equipmentName) + ' × ' + r.quantity + '</b> for ' + esc(r.studentName) + '? Stock is not deducted until you issue the equipment.' },
      () => { const res = approveRequest(r.id); toast(res.ok ? 'Request approved.' : res.error, res.ok ? '' : 'error'); done(); });
    if (b.dataset.act === 'cancel' && !admin) confirmAction({ title: 'Cancel request?', danger: true, confirmLabel: 'Cancel request', message: 'Cancel your pending request <b>' + esc(r.id) + '</b>?' },
      () => { const res = cancelRequest(r.id, USER); toast(res.ok ? 'Request cancelled.' : res.error, res.ok ? '' : 'error'); done(); });
  });
};

/* ===== Returns (admin) ===== */
pages.returns = function (el, params) {
  let q = '';
  el.innerHTML = pageHead('Equipment Returns', 'Verify returns submitted by students and record equipment that is brought back.') +
    '<div class="toolbar"><div class="field grow"><label for="rq">Search borrowed items</label><input type="search" id="rq" placeholder="Student name, Student ID, equipment, request ID"></div></div>' +
    '<div class="table-wrap"><table class="stack"><thead><tr><th>Request</th><th>Student</th><th>Equipment</th><th>Issued / Due</th><th>Outstanding</th><th>Status</th><th>Action</th></tr></thead><tbody id="rows"></tbody></table></div>' +
    '<div class="card" style="margin-top:18px"><h3>Return records</h3><div class="table-wrap"><table class="stack"><thead><tr><th>Return ID</th><th>Date</th><th>Student</th><th>Equipment</th><th>Qty</th><th>Condition</th><th>Status</th><th>Notes</th></tr></thead><tbody id="hist"></tbody></table></div></div>';
  const render = () => {
    const s = q.toLowerCase();
    const list = getBorrowingRequests().filter((r) => ['Borrowed', 'Overdue'].includes(r.status) && (!s || [r.id, r.studentName, r.studentId, r.equipmentName].join(' ').toLowerCase().includes(s)))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    $('#rows').innerHTML = list.length ? list.map((r) => '<tr class="' + (r.status === 'Overdue' ? 'row-overdue' : '') + '"><td data-label="Request"><b>' + esc(r.id) + '</b></td><td data-label="Student">' + esc(r.studentName) + '<span class="sub">' + esc(r.studentId) + '</span></td>' +
      '<td data-label="Equipment">' + esc(r.equipmentName) + '<span class="sub">' + esc(r.equipmentId) + '</span></td><td data-label="Issued / Due">' + fmtDate(r.issueDate) + '<span class="sub">Due ' + fmtDate(r.dueDate) + '</span></td>' +
      '<td data-label="Outstanding">' + outstandingQty(r) + ' of ' + r.quantity + '</td><td data-label="Status">' + badge(r.status) + (pendingReturnFor(r.id) ? ' ' + badge('Pending Verification') : '') + '</td><td class="acts">' + (pendingReturnFor(r.id) ? '<button class="btn btn-sm btn-primary" data-verify="' + pendingReturnFor(r.id).id + '" type="button">Verify return</button>' : '<button class="btn btn-sm btn-primary" data-ret="' + r.id + '" type="button">Record return</button>') + '</td></tr>').join('')
      : '<tr><td colspan="7" class="empty">No equipment is waiting to be returned.</td></tr>';
    const hist = getReturns().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    $('#hist').innerHTML = hist.length ? hist.map((h) => '<tr><td data-label="Return ID">' + esc(h.id) + '<span class="sub">' + esc(h.requestId) + '</span></td><td data-label="Date">' + fmtDate(h.returnDate) + '<span class="sub">' + esc(h.submittedAt ? fmtDateTime(h.submittedAt) : 'Logged ' + fmtDateTime(h.recordedAt)) + '</span></td><td data-label="Student">' + esc(h.studentName) + '</td><td data-label="Equipment">' + esc(h.equipmentName) + '</td><td data-label="Qty">' + h.quantity + '</td><td data-label="Condition">' + badge(h.condition) + '</td><td data-label="Status">' + badge(retStatus(h)) + (h.confirmedBy ? '<span class="sub">' + esc(h.confirmedBy) + '</span>' : '') + '</td><td data-label="Notes">' + esc(retStatus(h) === 'Rejected' ? 'Not accepted: ' + h.rejectReason : (h.notes || '—')) + '</td></tr>').join('')
      : '<tr><td colspan="8" class="empty">No returns recorded yet.</td></tr>';
  };
  const openReturn = (id) => {
    const waiting = pendingReturnFor(id);
    if (waiting) { openVerify(waiting.id); return; }          // the student already handed it in: verify that instead
    const r = getRequestById(id);
    if (!r || !['Borrowed', 'Overdue'].includes(r.status)) { toast('That request is not waiting for a return.', 'error'); return; }
    const out = outstandingQty(r);
    openModal({
      title: 'Record return — ' + r.id,
      body: kv([['Student', r.studentName + ' (' + r.studentId + ')'], ['Equipment', r.equipmentName], ['Issued', r.quantity + ' on ' + fmtDate(r.issueDate)], ['Due', fmtDate(r.dueDate)], ['Still outstanding', out]]) +
        '<form id="rtForm" novalidate><div class="row2"><div class="field"><label for="rt_q">Quantity returned now</label><input type="number" id="rt_q" name="qty" min="1" max="' + out + '" value="' + out + '"><small class="error" data-for="qty"></small></div>' +
        '<div class="field"><label for="rt_d">Actual return date</label><input type="date" id="rt_d" name="date" min="' + esc(r.issueDate) + '" max="' + todayStr() + '" value="' + todayStr() + '"><small class="error" data-for="date"></small></div></div>' +
        '<div class="field"><label for="rt_c">Condition of returned equipment</label><select id="rt_c" name="condition">' + RETURN_CONDITIONS.map((c) => '<option>' + c + '</option>').join('') + '</select><small class="error" data-for="condition"></small><small class="muted">Damaged or Needs Repair items are kept out of available stock.</small></div>' +
        '<div class="field"><label for="rt_n">Notes (damaged or missing items)</label><textarea id="rt_n" name="notes"></textarea><small class="error" data-for="notes"></small></div></form>',
      actions: [{ label: 'Cancel', cls: 'btn-ghost' }, { label: 'Confirm return', cls: 'btn-primary', onClick: (m) => {
        const form = $('#rtForm', m), res = recordReturn(r.id, formData(form));
        if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors).length) toast(res.error, 'error'); return false; }
        toast(res.data.status === 'Returned' ? 'Return recorded. Request closed.' : 'Partial return recorded. ' + outstandingQty(res.data) + ' unit(s) still outstanding.'); render();
      } }]
    });
  };
  const rejectReturnDialog = (rec) => {
    openModal({
      title: 'Return not accepted — ' + rec.id,
      body: '<p>The equipment is <b>not</b> marked as returned and stock does not change. The student will see your reason and can submit again.</p><form id="rjrForm" novalidate><div class="field"><label for="rjr_r">Reason</label><textarea id="rjr_r" name="reason"></textarea><small class="error" data-for="reason"></small></div></form>',
      actions: [{ label: 'Back', cls: 'btn-ghost', onClick: () => { openVerify(rec.id); return false; } }, { label: 'Reject return', cls: 'btn-danger solid', onClick: (m) => {
        const form = $('#rjrForm', m), res = rejectReturn(rec.id, formData(form).reason);
        if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors).length) toast(res.error, 'error'); return false; }
        toast('Return rejected. Stock was not changed.'); render();
      } }]
    });
  };
  const openVerify = (retId) => {
    const rec = getReturns().find((x) => x.id === retId);
    if (!rec || retStatus(rec) !== 'Pending Verification') { toast('That return is no longer waiting for verification.', 'error'); render(); return; }
    const r = getRequestById(rec.requestId);
    openModal({
      title: 'Verify return — ' + rec.id, wide: true,
      body: kv([['Student', rec.studentName + ' (' + rec.studentId + ')'], ['Equipment', rec.equipmentName + ' (' + rec.equipmentId + ')'], ['Borrowing record', rec.requestId + (r ? ' · due ' + fmtDate(r.dueDate) : '')],
        ['Quantity handed in', rec.quantity + (r ? ' of ' + outstandingQty(r) + ' outstanding' : '')], ['Handed in on', fmtDateTime(rec.submittedAt)], ['Condition said by student', rec.condition], ['Student notes', rec.notes]]) +
        '<form id="vfForm" novalidate><div class="field"><label for="vf_c">Condition after your inspection</label><select id="vf_c" name="condition">' + RETURN_CONDITIONS.map((c) => '<option' + (c === rec.condition ? ' selected' : '') + '>' + c + '</option>').join('') + '</select><small class="error" data-for="condition"></small><small class="muted">Only equipment in Good condition goes back to available stock.</small></div>' +
        '<div class="field"><label for="vf_n">Notes</label><textarea id="vf_n" name="notes">' + esc(rec.notes) + '</textarea><small class="error" data-for="notes"></small></div></form>',
      actions: [{ label: 'Cancel', cls: 'btn-ghost' }, { label: 'Not received', cls: 'btn-danger', keepOpen: true, onClick: () => { rejectReturnDialog(rec); } }, { label: 'Confirm return', cls: 'btn-primary', onClick: (m) => {
        const form = $('#vfForm', m), res = confirmReturn(rec.id, formData(form));
        if (!res.ok) { setErrors(form, res.errors); if (!Object.keys(res.errors).length) toast(res.error, 'error'); return false; }
        toast(res.data.status === 'Returned' ? 'Return confirmed. Stock updated.' : 'Partial return confirmed. ' + outstandingQty(res.data) + ' unit(s) still outstanding.'); render();
      } }]
    });
  };
  render();
  $('#rq').addEventListener('input', (e) => { q = e.target.value.trim(); render(); });
  $('#rows').addEventListener('click', (e) => {
    const v = e.target.closest('[data-verify]'); if (v) { openVerify(v.dataset.verify); return; }
    const b = e.target.closest('[data-ret]'); if (b) openReturn(b.dataset.ret);
  });
  const pre = params.get('req');
  if (pre) openReturn(pre);
  const ver = params.get('verify');
  if (ver) { const pr = pendingReturnFor(ver); if (pr) openVerify(pr.id); else toast('That return is no longer waiting for verification.', 'error'); }
};

/* ===== Transactions (+ reports for admin) ===== */

function buildReport(type) {
  const eqs = getEquipment(), reqs = getBorrowingRequests(), txns = getTransactions().slice().sort((a, b) => b.datetime.localeCompare(a.datetime));
  const R = {
    inventory: ['Current Inventory Report', ['ID', 'Equipment', 'Category', 'Condition', 'Status', 'Total', 'Available', 'Borrowed', 'Damaged/Repair'], eqs.map((e) => [e.id, e.name, e.category, e.condition, stockLabel(e), e.totalQty, e.availableQty, e.borrowedQty, e.unusableQty])],
    available: ['Available Equipment Report', ['ID', 'Equipment', 'Category', 'Available to borrow', 'Total'], eqs.filter((e) => borrowableQty(e) > 0).map((e) => [e.id, e.name, e.category, borrowableQty(e), e.totalQty])],
    borrowed: ['Borrowed Equipment Report', ['Request', 'Student', 'Student ID', 'Equipment', 'Outstanding', 'Issued', 'Due', 'Status'], reqs.filter((r) => ['Borrowed', 'Overdue'].includes(r.status)).map((r) => [r.id, r.studentName, r.studentId, r.equipmentName, outstandingQty(r), fmtDate(r.issueDate), fmtDate(r.dueDate), r.status])],
    overdue: ['Overdue Equipment Report', ['Request', 'Student', 'Student ID', 'Equipment', 'Outstanding', 'Due', 'Days late'], reqs.filter((r) => r.status === 'Overdue').map((r) => [r.id, r.studentName, r.studentId, r.equipmentName, outstandingQty(r), fmtDate(r.dueDate), daysBetween(r.dueDate, todayStr())])],
    requests: ['Borrowing Requests Report', ['Request', 'Submitted', 'Student', 'Student ID', 'Equipment', 'Qty', 'Borrow date', 'Return date', 'Status'], reqs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => [r.id, fmtDate(r.createdAt.slice(0, 10)), r.studentName, r.studentId, r.equipmentName, r.quantity, fmtDate(r.borrowDate), fmtDate(r.returnDate), r.status])],
    returned: ['Returned Equipment Report', ['Return ID', 'Request', 'Return date', 'Student', 'Equipment', 'Qty', 'Condition', 'Notes'], getReturns().filter((h) => retStatus(h) === 'Confirmed').sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map((h) => [h.id, h.requestId, fmtDate(h.returnDate), h.studentName, h.equipmentName, h.quantity, h.condition, h.notes])],
    transactions: ['Transaction History Report', TX_HEAD, txns.map(txRow)]
  };
  return R[type];
}
const TX_HEAD = ['Transaction', 'Date & time', 'Student', 'Equipment', 'Qty', 'Action', 'Status', 'Notes'];
const txRow = (t) => [t.id, fmtDateTime(t.datetime), t.studentName + (t.studentId !== '—' ? ' (' + t.studentId + ')' : ''), t.equipmentName + ' (' + t.equipmentId + ')', t.quantity, t.action, t.status || '—', t.notes || ''];

pages.transactions = function (el, params) {
  const admin = USER.role === 'admin';
  const f = { q: '', action: '', from: '', to: '' };
  let tab = admin && params.get('tab') === 'reports' ? 'reports' : 'history';
  const source = () => (admin ? getTransactions() : getTransactionsForStudent(USER.studentId)).slice().sort((a, b) => b.datetime.localeCompare(a.datetime));
  const filtered = () => {
    const q = f.q.toLowerCase();
    return source().filter((t) => (!f.action || t.action === f.action) && (!f.from || localDateOf(new Date(t.datetime)) >= f.from) && (!f.to || localDateOf(new Date(t.datetime)) <= f.to) &&
      (!q || [t.id, t.studentName, t.studentId, t.equipmentName, t.equipmentId, t.action, t.notes, t.requestId].join(' ').toLowerCase().includes(q)));
  };
  const historyView = () => {
    const actions = Array.from(new Set(source().map((t) => t.action))).sort();
    $('#tabBody').innerHTML = '<div class="toolbar"><div class="field grow"><label for="tq">Search</label><input type="search" id="tq" placeholder="' + (admin ? 'Student, ID, equipment, action, notes' : 'Equipment, action, request ID') + '" value="' + esc(f.q) + '"></div>' +
      '<div class="field"><label for="ta">Action</label><select id="ta"><option value="">All actions</option>' + actions.map((a) => '<option' + (a === f.action ? ' selected' : '') + '>' + esc(a) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="tf">From</label><input type="date" id="tf" value="' + f.from + '"></div><div class="field"><label for="tt">To</label><input type="date" id="tt" value="' + f.to + '"></div>' +
      '</div><div class="table-wrap"><table class="stack"><thead><tr>' + TX_HEAD.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody id="tx"></tbody></table></div>';
    const draw = () => {
      const list = filtered();
      $('#tx').innerHTML = list.length ? list.map((t) => { const r = txRow(t); return '<tr>' + r.map((c, i) => '<td data-label="' + TX_HEAD[i] + '">' + esc(c) + '</td>').join('') + '</tr>'; }).join('') : '<tr><td colspan="8" class="empty">No transactions found.</td></tr>';
    };
    draw();
    $('#tq').addEventListener('input', (e) => { f.q = e.target.value.trim(); draw(); });
    $('#ta').addEventListener('change', (e) => { f.action = e.target.value; draw(); });
    $('#tf').addEventListener('change', (e) => { f.from = e.target.value; draw(); });
    $('#tt').addEventListener('change', (e) => { f.to = e.target.value; draw(); });
  };
  const reportsView = () => {
    const names = { inventory: 'Current inventory', available: 'Available equipment', borrowed: 'Borrowed equipment', overdue: 'Overdue equipment', requests: 'Borrowing requests', returned: 'Returned equipment', transactions: 'Transaction history' };
    $('#tabBody').innerHTML = '<div class="toolbar"><div class="field grow"><label for="rt">Report</label><select id="rt">' + Object.keys(names).map((k) => '<option value="' + k + '">' + names[k] + '</option>').join('') + '</select></div><button class="btn btn-primary" id="printBtn" type="button">Print Report</button></div><p class="muted small no-print">Tip: in the print window choose <b>Save as PDF</b> as the printer to make a PDF file.</p><div class="card"><div id="rpt"></div></div>';
    const draw = () => {
      const rep = buildReport($('#rt').value);
      $('#rpt').innerHTML = '<div class="print-head"><img src="images/vci-logo.jpg" alt="VCI-CUSTODIAN Logo"><div><strong>Veritas College of Irosin</strong><span>VCI CUSTODIAN - Sports Equipment Borrowing and Return System</span><span>' + esc(rep[0]) + ' &middot; ' + esc(fmtDate(todayStr())) + '</span></div></div><h3>' + esc(rep[0]) + '</h3><p class="muted small">Generated ' + esc(fmtDateTime(nowIso())) + ' · ' + rep[2].length + ' record(s)</p><div class="table-wrap">' + simpleTable(rep[1], rep[2]) + '</div>';
    };
    draw();
    $('#rt').addEventListener('change', draw);
    $('#printBtn').addEventListener('click', () => { if (!buildReport($('#rt').value)[2].length) toast('This report has no records yet. A blank report will be printed.', 'error'); window.print(); });
  };
  const show = () => {
    if (admin) $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
    tab === 'reports' ? reportsView() : historyView();
  };
  el.innerHTML = pageHead(admin ? 'Transactions & Reports' : 'My Borrowing History', admin ? 'Every action is recorded here. Switch to Reports for summaries.' : 'Your own requests and returns.') +
    (admin ? '<div class="tabs"><button class="tab" data-tab="history" type="button">Transaction history</button><button class="tab" data-tab="reports" type="button">Reports</button></div>' : '') + '<div id="tabBody"></div>';
  if (admin) $$('.tab').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; history.replaceState(null, '', tab === 'reports' ? '#/transactions?tab=reports' : '#/transactions'); show(); }));
  show();
};

/* ---------------------------------------------------------
   ROUTER + START-UP
   The whole app lives in index.html. Pages are "routes" like #/admin or
   #/inventory. Each route renders into the page and the browser's
   back/forward buttons keep working.
   --------------------------------------------------------- */
const ROUTES = {
  login: { access: 'public', title: 'Login' }, register: { access: 'public', title: 'Register' },
  admin: { access: 'admin', title: 'Admin Dashboard' }, student: { access: 'student', title: 'Student Dashboard' },
  inventory: { access: 'any', title: 'Equipment Inventory' }, borrowing: { access: 'any', title: 'Borrowing Requests' },
  returns: { access: 'admin', title: 'Equipment Returns' }, transactions: { access: 'any', title: 'Transactions' }
};
function mount(templateId) {
  const box = $('#auth');
  box.innerHTML = $('#' + templateId).innerHTML;
}
function navigate(name, query) {
  const target = '#/' + name + (query ? '?' + query : '');
  if (location.hash === target) route(); else location.hash = target;
}
function route() {
  closeModal();
  document.body.classList.remove('nav-open');
  refreshOverdue();
  USER = currentUser();
  const h = location.hash.replace(/^#\/?/, '').split('?');
  let name = h[0], params = new URLSearchParams(h[1] || '');
  if (!ROUTES[name]) { navigate(USER ? homeFor(USER) : 'login'); return; }
  const cfg = ROUTES[name], body = document.body;
  // Basic frontend role checks (demo only - real systems must enforce these on the server)
  if (cfg.access === 'public' && USER) { navigate(homeFor(USER)); return; }
  if (cfg.access !== 'public' && !USER) { navigate('login'); return; }
  if (cfg.access === 'admin' && USER.role !== 'admin') { navigate('student'); return; }
  if (cfg.access === 'student' && USER.role !== 'student') { navigate('admin'); return; }
  body.dataset.page = name; body.dataset.title = cfg.title;
  document.title = cfg.title + ' | VCI CUSTODIAN';
  const isAuth = cfg.access === 'public';
  body.classList.toggle('auth-body', isAuth);
  $('#auth').hidden = !isAuth; $('.app').hidden = isAuth;
  if (isAuth) { pages[name](); }
  else {
    renderShell(USER); pages[name]($('#content'), params);
    if (USER.role === 'student' && USER.mustChangePassword) changeStudentPasswordDialog(true);   // after an Admin reset the student must pick a new password
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
document.addEventListener('DOMContentLoaded', () => {
  initData();          // creates the Admin account and sample equipment only when missing
  route();
});